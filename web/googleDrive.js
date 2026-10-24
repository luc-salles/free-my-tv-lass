/**
 * Google Drive photos for the screensaver: the images in a folder shared as "Anyone with the link",
 * listed with the Drive API and an API key (no sign-in on the TV). ES5 only.
 *   config.properties: gdrive_folder_id, gdrive_api_key
 */
(function () {
  'use strict';

  var SOURCE_KEY = 'screensaver_source';
  var LIST_KEY = 'screensaver_gdrive_list';
  var GEO_KEY = 'screensaver_gdrive_geo';
  var LIST_TTL = 4 * 3600000;   // Drive's thumbnail links stop working after a few hours

  var list = null, index = 0, loading = false, waiting = [], lastError = '';
  var geoCache = null;

  var PT = {
    'Screensaver': 'Descanso de Tela',
    'Screensaver Source': 'Fonte do Descanso',
    'Default (Picks)': 'Padrão (Destaques)',
    'Google Drive': 'Google Drive',
    'Photos in folder': 'Fotos na pasta',
    'Reload photos': 'Recarregar fotos',
    'Not configured': 'Não configurado',
    'Loading...': 'Carregando...',
    'Add gdrive_folder_id and gdrive_api_key to config.properties.': 'Adicione gdrive_folder_id e gdrive_api_key em config.properties.',
    'No photos in the folder.': 'Nenhuma foto na pasta.',
    'Photos reloaded': 'Fotos recarregadas'
  };

  function t(english) {
    var lang = (window.I18N && window.I18N.lang) || (window.CONFIG && window.CONFIG.language) || '';
    if (String(lang).indexOf('pt') === 0 && PT[english]) return PT[english];
    return english;
  }

  function folderId() { return (window.CONFIG && window.CONFIG.gdriveFolderId) || ''; }
  function apiKey() { return (window.CONFIG && window.CONFIG.gdriveApiKey) || ''; }
  function isConfigured() { return !!(folderId() && apiKey()); }

  function getSource() {
    try { if (localStorage.getItem(SOURCE_KEY) === 'gdrive' && isConfigured()) return 'gdrive'; } catch (e) {}
    return 'default';
  }

  function setSource(src) {
    try { localStorage.setItem(SOURCE_KEY, src === 'gdrive' ? 'gdrive' : 'default'); } catch (e) {}
  }

  function saved() {
    try {
      var s = JSON.parse(localStorage.getItem(LIST_KEY) || 'null');
      if (s && s.v === 2 && s.folder === folderId() && Date.now() - s.at < LIST_TTL) return s.items;
    } catch (e) {}
    return null;
  }

  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1)), x = a[i];
      a[i] = a[j];
      a[j] = x;
    }
    return a;
  }

  function mediaUrl(id) {
    return 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) + '?alt=media&key=' + encodeURIComponent(apiKey());
  }

  function finish(err) {
    loading = false;
    var w = waiting;
    waiting = [];
    for (var i = 0; i < w.length; i++) w[i](err);
  }

  // MARK: - Reverse Geocoding (simplified location)

  function loadGeoCache() {
    if (!geoCache) {
      try { geoCache = JSON.parse(localStorage.getItem(GEO_KEY) || '{}'); } catch (e) { geoCache = {}; }
    }
    return geoCache;
  }

  function saveGeoCache(c) {
    try { localStorage.setItem(GEO_KEY, JSON.stringify(c)); } catch (e) {}
  }

  function geoKey(lat, lon) {
    return (Math.round(lat * 100) / 100) + ',' + (Math.round(lon * 100) / 100);
  }

  function formatLocation(data) {
    if (!data) return '';
    var city = data.city || data.locality || '';
    var countryCode = (data.countryCode || '').toUpperCase();
    var country = data.countryName || '';
    var sub = data.principalSubdivision || '';
    var subCode = (data.principalSubdivisionCode || '').replace(/^[A-Z]+-/, '');

    // No Brasil: "Cidade, UF" (ex: "Manaus, AM", "Gramado, RS")
    if (countryCode === 'BR') {
      var uf = subCode || sub;
      if (city && uf && city !== uf) return city + ', ' + uf;
      return city || uf || country;
    }

    // No exterior: "Cidade, País" (ex: "Orlando, Estados Unidos", "Paris, França")
    if (city && country && city !== country) {
      return city + ', ' + country;
    }
    return city || sub || country || '';
  }

  function reverseGeocodeNominatim(lat, lon, key, lang, cb) {
    var c = loadGeoCache();
    var url = 'https://nominatim.openstreetmap.org/reverse?lat=' + encodeURIComponent(lat) +
      '&lon=' + encodeURIComponent(lon) + '&format=json&accept-language=' + encodeURIComponent(lang);
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.timeout = 4000;
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      if (xhr.status === 200) {
        var data = null;
        try { data = JSON.parse(xhr.responseText); } catch (e) {}
        if (data && data.address) {
          var a = data.address;
          var city = a.city || a.town || a.village || a.municipality || a.city_district || '';
          var countryCode = (a.country_code || '').toUpperCase();
          var country = a.country || '';
          var subCode = a['ISO3166-2-lvl4'] ? a['ISO3166-2-lvl4'].replace(/^[A-Z]+-/, '') : (a.state || '');
          var simplified = '';
          if (countryCode === 'BR') {
            simplified = (city && subCode && city !== subCode) ? (city + ', ' + subCode) : (city || subCode || country);
          } else {
            simplified = (city && country && city !== country) ? (city + ', ' + country) : (city || country);
          }
          if (simplified) {
            c[key] = simplified;
            saveGeoCache(c);
            cb(simplified);
            return;
          }
        }
      }
      cb(null);
    };
    xhr.ontimeout = function () { cb(null); };
    xhr.onerror = function () { cb(null); };
    xhr.send();
  }

  function reverseGeocode(lat, lon, cb) {
    var c = loadGeoCache();
    var key = geoKey(lat, lon);
    if (c[key]) { cb(c[key]); return; }

    var lang = (window.I18N && window.I18N.lang) || (window.CONFIG && window.CONFIG.language) || 'pt';
    var url = 'https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=' +
      encodeURIComponent(lat) + '&longitude=' + encodeURIComponent(lon) +
      '&localityLanguage=' + encodeURIComponent(lang);

    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.timeout = 4000;
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      if (xhr.status === 200) {
        var data = null;
        try { data = JSON.parse(xhr.responseText); } catch (e) {}
        var simplified = formatLocation(data);
        if (simplified) {
          c[key] = simplified;
          saveGeoCache(c);
          cb(simplified);
          return;
        }
      }
      reverseGeocodeNominatim(lat, lon, key, lang, cb);
    };
    xhr.ontimeout = function () { reverseGeocodeNominatim(lat, lon, key, lang, cb); };
    xhr.onerror = function () { reverseGeocodeNominatim(lat, lon, key, lang, cb); };
    xhr.send();
  }

  /** Lists the folder's images (all pages), then calls done(error). */
  function load(done, force) {
    if (!isConfigured()) { lastError = t('Add gdrive_folder_id and gdrive_api_key to config.properties.'); done(new Error(lastError)); return; }
    if (!force && list) { done(null); return; }
    var cached = force ? null : saved();
    if (cached) { list = shuffle(cached); index = 0; done(null); return; }
    waiting.push(done);
    if (loading) return;
    loading = true;

    var items = [];
    var q = "'" + folderId() + "' in parents and mimeType contains 'image/' and trashed = false";
    function page(token) {
      var url = 'https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(q) +
        '&fields=' + encodeURIComponent('nextPageToken,files(id,name,thumbnailLink,createdTime,imageMediaMetadata(time,location))') +
        '&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true&key=' + encodeURIComponent(apiKey()) +
        (token ? '&pageToken=' + encodeURIComponent(token) : '');
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
        var data = null;
        try { data = JSON.parse(xhr.responseText); } catch (e) {}
        if (xhr.status !== 200 || !data) {
          lastError = (data && data.error && data.error.message) || ('Google Drive: HTTP ' + xhr.status);
          finish(new Error(lastError));
          return;
        }
        var files = data.files || [];
        for (var i = 0; i < files.length; i++) {
          var f = files[i];
          var meta = f.imageMediaMetadata || {};
          var loc = meta.location || null;
          items.push({
            id: f.id,
            thumb: f.thumbnailLink ? f.thumbnailLink.replace(/=s\d+$/, '') + '=w1920-h1080' : '',
            time: meta.time || f.createdTime || '',
            lat: loc && typeof loc.latitude === 'number' ? loc.latitude : null,
            lon: loc && typeof loc.longitude === 'number' ? loc.longitude : null
          });
        }
        if (data.nextPageToken) { page(data.nextPageToken); return; }
        try { localStorage.setItem(LIST_KEY, JSON.stringify({v: 2, folder: folderId(), at: Date.now(), items: items})); } catch (e) {}
        list = shuffle(items);
        index = 0;
        lastError = items.length ? '' : t('No photos in the folder.');
        finish(null);
      };
      xhr.send();
    }
    page('');
  }

  /** Loads the image first, then calls back({url, title, location}) or null. */
  function preload(item, cb) {
    var urls = item.thumb ? [item.thumb, mediaUrl(item.id)] : [mediaUrl(item.id)];
    var n = 0;
    function attempt() {
      if (n >= urls.length) { cb(null); return; }
      var url = urls[n++], img = new Image();
      img.onload = function () {
        if (typeof item.lat === 'number' && typeof item.lon === 'number') {
          reverseGeocode(item.lat, item.lon, function (loc) {
            cb({url: url, title: loc || '', location: loc || ''});
          });
        } else {
          cb({url: url, title: '', location: ''});
        }
      };
      img.onerror = attempt;
      img.src = url;
    }
    attempt();
  }

  function getNextPhoto(cb) {
    load(function (err) {
      if (err || !list || !list.length) { cb(null); return; }
      var tries = 0;
      function next() {
        if (tries++ >= Math.min(list.length, 5)) { cb(null); return; }
        var item = list[index++ % list.length];
        preload(item, function (photo) { if (photo) cb(photo); else next(); });
      }
      next();
    });
  }

  function reload(cb) {
    list = null;
    try { localStorage.removeItem(LIST_KEY); } catch (e) {}
    load(function (err) { if (cb) cb(err); }, true);
  }

  window.GoogleDrive = {
    t: t,
    isConfigured: isConfigured,
    getSource: getSource,
    setSource: setSource,
    load: load,
    reload: reload,
    count: function () { return list ? list.length : -1; },
    getLastError: function () { return lastError; },
    getNextPhoto: getNextPhoto
  };
})();
