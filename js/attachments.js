// =====================================================================
// TG-SHI v6.0 -- js/attachments.js
// Image/document attachments for payments, flights, expenses, etc.
// Uses Cloudflare R2 via Worker endpoints: POST /upload, GET /file/:key
// ASCII-only source file
// =====================================================================

var Attachments = (function() {

  // Max file size: 10MB
  var MAX_FILE_SIZE = 10 * 1024 * 1024;
  var ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'];
  var ALLOWED_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.pdf'];

  // --- Helpers ---

  function getWorkerUrl() {
    return API.getWorkerUrl();
  }

  function getWorkerSecret() {
    return API.getWorkerSecret();
  }

  // Generate a unique key for the file
  function generateKey(file) {
    var ext = file.name.split('.').pop().toLowerCase();
    if (ALLOWED_EXT.indexOf('.' + ext) === -1) ext = 'jpg';
    var ts = Date.now().toString(36);
    var rand = Math.random().toString(36).slice(2, 8);
    return 'att_' + ts + '_' + rand + '.' + ext;
  }

  // Get the URL for a stored file
  function fileUrl(key) {
    return getWorkerUrl() + '/file/' + key;
  }

  // Get thumbnail URL (same as file URL - Worker serves the image)
  function thumbUrl(key) {
    return fileUrl(key);
  }

  // --- Upload a file to R2 via Worker ---
  // Returns Promise<{ ok: true, key: string } | { ok: false, error: string }>

  function uploadFile(file) {
    return new Promise(function(resolve) {
      if (!file) {
        resolve({ ok: false, error: 'No file selected' });
        return;
      }
      if (file.size > MAX_FILE_SIZE) {
        resolve({ ok: false, error: 'Archivo muy grande (max 10MB)' });
        return;
      }
      var ext = '.' + file.name.split('.').pop().toLowerCase();
      if (ALLOWED_EXT.indexOf(ext) === -1) {
        resolve({ ok: false, error: 'Tipo no permitido. Usa JPG, PNG, WebP, HEIC o PDF.' });
        return;
      }

      var key = generateKey(file);
      var formData = new FormData();
      formData.append('file', file);
      formData.append('key', key);

      fetch(getWorkerUrl() + '/upload', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + getWorkerSecret()
        },
        body: formData
      })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.ok) {
          resolve({ ok: true, key: data.key || key });
        } else {
          resolve({ ok: false, error: data.error || 'Upload failed' });
        }
      })
      .catch(function(e) {
        resolve({ ok: false, error: 'Error de conexion: ' + e.message });
      });
    });
  }

  // --- Delete a file from R2 via Worker ---

  function deleteFile(key) {
    return fetch(getWorkerUrl() + '/file/' + key, {
      method: 'DELETE',
      headers: {
        'Authorization': 'Bearer ' + getWorkerSecret()
      }
    })
    .then(function(r) { return r.json(); })
    .catch(function(e) { return { ok: false, error: e.message }; });
  }

  // ===== UI COMPONENTS =====

  // --- Render attachment thumbnails for a record ---
  // attachments: array of keys (strings)
  // Returns HTML string with thumbnail strip

  function renderThumbs(attachments) {
    if (!attachments || attachments.length === 0) return '';
    var h = '<div class="att-thumbs">';
    attachments.forEach(function(key, idx) {
      var isPdf = key.toLowerCase().endsWith('.pdf');
      if (isPdf) {
        h += '<div class="att-th att-pdf" onclick="Attachments.openViewer(\'' + escKey(key) + '\')" title="PDF">'
          + '<div style="font-size:16px">PDF</div>'
          + '</div>';
      } else {
        h += '<img class="att-th" src="' + thumbUrl(key) + '" '
          + 'onclick="Attachments.openViewer(\'' + escKey(key) + '\')" '
          + 'loading="lazy" alt="adjunto" '
          + 'onerror="this.style.display=\'none\'">';
      }
    });
    h += '</div>';
    return h;
  }

  // --- Render a small attachment indicator (paperclip icon + count) ---
  function renderBadge(attachments) {
    if (!attachments || attachments.length === 0) return '';
    return '<span class="att-badge" title="' + attachments.length + ' adjunto(s)">'
      + '<span class="att-clip">&#128206;</span>' + attachments.length
      + '</span>';
  }

  // --- Render the attachment management section for edit forms ---
  // containerId: DOM id where to render
  // attachments: array of keys (current)
  // onChangeCallback: function name string called when attachments change (global scope)
  // Returns nothing, populates the container

  function renderEditSection(containerId, attachments, tempVarName) {
    var container = document.getElementById(containerId);
    if (!container) return;

    // Store current attachments in a temp global variable for form interaction
    if (!window._attTemp) window._attTemp = {};
    window._attTemp[tempVarName] = (attachments || []).slice();

    var h = '<div class="att-edit-section">';
    h += '<label class="fl" style="margin-bottom:6px">Adjuntos</label>';

    // Existing thumbnails with remove buttons
    h += '<div class="att-edit-list" id="' + containerId + '-list">';
    h += buildEditList(window._attTemp[tempVarName], containerId, tempVarName);
    h += '</div>';

    // Add button (camera on mobile, file picker)
    h += '<div class="att-add-row">';
    h += '<label class="att-add-btn" for="' + containerId + '-input">';
    h += '<span class="att-add-icon">+</span> Adjuntar foto / archivo';
    h += '</label>';
    h += '<input type="file" id="' + containerId + '-input" '
      + 'accept="image/*,.pdf" capture="environment" '
      + 'style="display:none" multiple '
      + 'onchange="Attachments.handleFileInput(\'' + containerId + '\',\'' + tempVarName + '\',this)">';
    h += '</div>';

    // Upload status
    h += '<div id="' + containerId + '-status" class="att-status"></div>';

    h += '</div>';
    container.innerHTML = h;
  }

  function buildEditList(keys, containerId, tempVarName) {
    if (!keys || keys.length === 0) return '<div class="att-empty">Sin adjuntos</div>';
    var h = '';
    keys.forEach(function(key, idx) {
      var isPdf = key.toLowerCase().endsWith('.pdf');
      h += '<div class="att-edit-item">';
      if (isPdf) {
        h += '<div class="att-th att-pdf" onclick="Attachments.openViewer(\'' + escKey(key) + '\')" style="cursor:pointer">'
          + '<div style="font-size:14px">PDF</div></div>';
      } else {
        h += '<img class="att-th" src="' + thumbUrl(key) + '" '
          + 'onclick="Attachments.openViewer(\'' + escKey(key) + '\')" '
          + 'style="cursor:pointer" loading="lazy" alt="adjunto" '
          + 'onerror="this.outerHTML=\'<div class=att-th style=background:#F0F2F6;display:flex;align-items:center;justify-content:center;font-size:10px;color:#8892A4>ERR</div>\'">';
      }
      h += '<button class="att-remove" onclick="Attachments.removeFromEdit(\'' + containerId + '\',\'' + tempVarName + '\',' + idx + ')" title="Eliminar">&times;</button>';
      h += '</div>';
    });
    return h;
  }

  // --- Handle file input change (upload immediately) ---

  function handleFileInput(containerId, tempVarName, inputEl) {
    var files = inputEl.files;
    if (!files || files.length === 0) return;
    var statusEl = document.getElementById(containerId + '-status');

    var toUpload = [];
    for (var i = 0; i < files.length; i++) {
      toUpload.push(files[i]);
    }

    var uploaded = 0;
    var errors = [];

    if (statusEl) {
      statusEl.textContent = 'Subiendo ' + toUpload.length + ' archivo(s)...';
      statusEl.className = 'att-status att-uploading';
    }

    var processNext = function(idx) {
      if (idx >= toUpload.length) {
        // All done
        if (statusEl) {
          if (errors.length > 0) {
            statusEl.textContent = errors.join('; ');
            statusEl.className = 'att-status att-error';
          } else {
            statusEl.textContent = uploaded + ' archivo(s) subido(s)';
            statusEl.className = 'att-status att-success';
            setTimeout(function() { if (statusEl) statusEl.textContent = ''; }, 3000);
          }
        }
        // Clear input
        inputEl.value = '';
        // Refresh the thumbnail list
        var listEl = document.getElementById(containerId + '-list');
        if (listEl) {
          listEl.innerHTML = buildEditList(window._attTemp[tempVarName], containerId, tempVarName);
        }
        return;
      }

      uploadFile(toUpload[idx]).then(function(result) {
        if (result.ok) {
          window._attTemp[tempVarName].push(result.key);
          uploaded++;
        } else {
          errors.push(toUpload[idx].name + ': ' + result.error);
        }
        if (statusEl && idx < toUpload.length - 1) {
          statusEl.textContent = 'Subiendo ' + (idx + 2) + ' de ' + toUpload.length + '...';
        }
        processNext(idx + 1);
      });
    };

    processNext(0);
  }

  // --- Remove attachment from edit list ---

  function removeFromEdit(containerId, tempVarName, idx) {
    var keys = window._attTemp[tempVarName];
    if (!keys || idx < 0 || idx >= keys.length) return;
    // Note: we don't delete from R2 here - orphan cleanup can be a future background task
    keys.splice(idx, 1);
    var listEl = document.getElementById(containerId + '-list');
    if (listEl) {
      listEl.innerHTML = buildEditList(keys, containerId, tempVarName);
    }
  }

  // --- Get current attachments from temp variable ---

  function getEditAttachments(tempVarName) {
    if (!window._attTemp) return [];
    return window._attTemp[tempVarName] || [];
  }

  // ===== FULL-SCREEN IMAGE VIEWER =====

  function openViewer(key) {
    // Remove existing viewer
    closeViewer();

    var isPdf = key.toLowerCase().endsWith('.pdf');
    var url = fileUrl(key);

    var overlay = document.createElement('div');
    overlay.id = 'att-viewer-overlay';
    overlay.className = 'att-viewer-overlay';
    overlay.onclick = function(e) {
      if (e.target === overlay) closeViewer();
    };

    var inner = '<div class="att-viewer-header">';
    inner += '<button class="att-viewer-close" onclick="Attachments.closeViewer()">&times;</button>';
    inner += '<a class="att-viewer-dl" href="' + url + '" target="_blank" rel="noopener">Abrir en nueva ventana</a>';
    inner += '</div>';

    if (isPdf) {
      inner += '<iframe class="att-viewer-pdf" src="' + url + '"></iframe>';
    } else {
      inner += '<div class="att-viewer-img-wrap">';
      inner += '<img class="att-viewer-img" src="' + url + '" alt="adjunto">';
      inner += '</div>';
    }

    overlay.innerHTML = inner;
    document.body.appendChild(overlay);

    // Prevent body scroll
    document.body.style.overflow = 'hidden';
  }

  function closeViewer() {
    var existing = document.getElementById('att-viewer-overlay');
    if (existing) {
      existing.remove();
      document.body.style.overflow = '';
    }
  }

  // --- Escape key for onclick attributes ---
  function escKey(key) {
    return key.replace(/'/g, "\\'").replace(/"/g, '\\"');
  }

  // ===== CSS INJECTION =====
  // Inject attachment-related styles once

  (function injectStyles() {
    if (document.getElementById('att-styles')) return;
    var style = document.createElement('style');
    style.id = 'att-styles';
    style.textContent = ''
      // Thumbnail strip
      + '.att-thumbs{display:flex;gap:5px;margin-top:5px;overflow-x:auto;scrollbar-width:none;padding:2px 0}'
      + '.att-thumbs::-webkit-scrollbar{display:none}'
      + '.att-th{width:40px;height:40px;border-radius:6px;object-fit:cover;flex-shrink:0;cursor:pointer;border:1px solid #E2E6EE;background:#F8F9FB}'
      + '.att-pdf{display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#8B1A1A;background:#FEE2E2}'
      // Badge
      + '.att-badge{display:inline-flex;align-items:center;gap:2px;font-size:9px;font-weight:700;color:#8892A4;margin-left:4px}'
      + '.att-clip{font-size:11px}'
      // Edit section
      + '.att-edit-section{margin-bottom:13px}'
      + '.att-edit-list{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;min-height:24px}'
      + '.att-edit-item{position:relative;display:inline-block}'
      + '.att-edit-item .att-th{width:56px;height:56px;border-radius:8px}'
      + '.att-remove{position:absolute;top:-4px;right:-4px;width:18px;height:18px;border-radius:50%;background:#8B1A1A;color:#fff;border:2px solid #fff;font-size:12px;line-height:12px;text-align:center;cursor:pointer;padding:0;font-weight:700}'
      + '.att-empty{font-size:10px;color:#8892A4;padding:4px 0}'
      // Add button
      + '.att-add-row{margin-bottom:6px}'
      + '.att-add-btn{display:inline-flex;align-items:center;gap:6px;padding:10px 16px;border:2px dashed #E2E6EE;border-radius:10px;cursor:pointer;font-size:12px;font-weight:600;color:#8892A4;background:#F8F9FB;transition:all .15s}'
      + '.att-add-btn:active{background:#E8EAF0;border-color:#8892A4}'
      + '.att-add-icon{font-size:18px;font-weight:300;color:#4A9EE8}'
      // Upload status
      + '.att-status{font-size:10px;min-height:14px;margin-top:2px}'
      + '.att-uploading{color:#B8600A}'
      + '.att-success{color:#1A6B3A}'
      + '.att-error{color:#8B1A1A}'
      // Viewer overlay
      + '.att-viewer-overlay{position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:9999;display:flex;flex-direction:column;align-items:center}'
      + '.att-viewer-header{width:100%;max-width:520px;display:flex;justify-content:space-between;align-items:center;padding:12px 16px;flex-shrink:0}'
      + '.att-viewer-close{background:none;border:none;color:#fff;font-size:28px;cursor:pointer;padding:4px 8px;line-height:1}'
      + '.att-viewer-dl{color:rgba(255,255,255,.7);font-size:11px;text-decoration:none;font-weight:600}'
      + '.att-viewer-dl:hover{color:#fff}'
      + '.att-viewer-img-wrap{flex:1;display:flex;align-items:center;justify-content:center;overflow:auto;padding:8px;width:100%}'
      + '.att-viewer-img{max-width:100%;max-height:100%;object-fit:contain;border-radius:4px}'
      + '.att-viewer-pdf{flex:1;width:100%;border:none;border-radius:4px}';
    document.head.appendChild(style);
  })();

  return {
    uploadFile: uploadFile,
    deleteFile: deleteFile,
    fileUrl: fileUrl,
    renderThumbs: renderThumbs,
    renderBadge: renderBadge,
    renderEditSection: renderEditSection,
    handleFileInput: handleFileInput,
    removeFromEdit: removeFromEdit,
    getEditAttachments: getEditAttachments,
    openViewer: openViewer,
    closeViewer: closeViewer
  };
})();
