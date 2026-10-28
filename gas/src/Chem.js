// 시약 등록 때 화학물질 정보 찾기 (설계: docs/superpowers/specs/2026-10-29-chem-lookup-design.md).
// The school's own data.go.kr key stays in the script properties; the web only
// gets names, CAS numbers, formulas and the classification text. Judging the
// hazard from that text is done in web/src/domain/chemLookup.ts.

var DATA_KEY_PROP = 'DATA_GO_KR_KEY';
var KOSHA_LIST_URL = 'https://apis.data.go.kr/B552468/msdschem1/getChemList001';
var KECO_LIST_URL = 'https://apis.data.go.kr/B552584/kecoapi/ncissbstn/chemSbstnList';

function chemActions() {
  return {
    'chem.search': { auth: 'user', write: false, handler: chemSearch },
    'chem.info': { auth: 'user', write: false, handler: chemInfo },
  };
}

// Sheet menu: an empty value removes the key.
function sheetSetDataKey(key) {
  var props = PropertiesService.getScriptProperties();
  var value = String(key || '').trim();
  if (value) props.setProperty(DATA_KEY_PROP, value);
  else props.deleteProperty(DATA_KEY_PROP);
  return !!value;
}

function dataKeyStatus() {
  return !!PropertiesService.getScriptProperties().getProperty(DATA_KEY_PROP);
}

function lookupFailed(message) {
  return apiError('LOOKUP_FAILED', message || '화학물질 정보를 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.');
}

// data.go.kr gateway reason codes (returnReasonCode).
function gatewayMessage(code) {
  if (code === '30') return '공공데이터 인증키가 등록되지 않았습니다. 시트 메뉴에 넣은 키가 data.go.kr의 일반 인증키와 같은지 확인해 주세요(발급 직후에는 1시간쯤 걸릴 수 있습니다).';
  if (code === '31') return '공공데이터 인증키의 사용 기간이 끝났습니다. data.go.kr에서 연장해 주세요.';
  if (code === '20' || code === '12') return '이 인증키로 쓸 수 없는 서비스입니다. data.go.kr에서 「물질안전보건자료 조회」와 「화학물질 정보 조회」를 활용 신청했는지 확인해 주세요.';
  if (code === '22') return '오늘 공공데이터 하루 호출 한도를 다 썼습니다. 내일 다시 찾아 주세요.';
  return null;
}

function dataKeyForUrl() {
  var key = PropertiesService.getScriptProperties().getProperty(DATA_KEY_PROP);
  if (!key) throw apiError('NO_API_KEY', '공공데이터 인증키가 없습니다. 운영 교사가 시트 메뉴 LabKeeper → 공공데이터 인증키 입력에서 넣어 주세요.');
  // The portal shows the key both URL-encoded and decoded; accept either.
  return /%[0-9A-Fa-f]{2}/.test(key) ? key : encodeURIComponent(key);
}

function fetchText(base, params) {
  var query = Object.keys(params)
    .map(function (k) {
      return k + '=' + encodeURIComponent(params[k]);
    })
    .join('&');
  var url = base + '?serviceKey=' + dataKeyForUrl() + '&' + query;
  var res;
  try {
    res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  } catch (err) {
    throw lookupFailed();
  }
  if (res.getResponseCode() !== 200) throw lookupFailed();
  var text = res.getContentText();
  var reason = /OpenAPI_ServiceResponse/.test(text) && /returnReasonCode"?\s*[:>]\s*"?(\d+)/.exec(text);
  if (reason) throw lookupFailed(gatewayMessage(reason[1]));
  return text;
}

function xmlField(block, name) {
  var m = new RegExp('<' + name + '>([\\s\\S]*?)</' + name + '>').exec(block);
  return m ? m[1] : '';
}

// KOSHA names come HTML-escaped, sometimes with "<br/>( 관용명 : … )".
function cleanName(s) {
  return String(s || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function koshaByName(word) {
  var text = fetchText(KOSHA_LIST_URL, { searchWrd: word, searchCnd: 0, numOfRows: 20, pageNo: 1 });
  if (xmlField(text, 'resultCode') !== '00') throw lookupFailed();
  var items = [];
  var re = /<item>([\s\S]*?)<\/item>/g;
  var m;
  while ((m = re.exec(text))) items.push({ name: cleanName(xmlField(m[1], 'chemNameKor')), casNo: xmlField(m[1], 'casNo').trim() });
  return items;
}

function kecoByCas(casNo) {
  var data;
  try {
    data = JSON.parse(fetchText(KECO_LIST_URL, { pageNo: 1, numOfRows: 10, searchGubun: 2, searchNm: casNo, returnType: 'JSON' }));
  } catch (err) {
    if (err && err.isApiError) throw err;
    throw lookupFailed();
  }
  var items = data && data.body && data.body.items;
  if (!Array.isArray(items)) throw lookupFailed();
  // searchNm may match partially; keep only this CAS No.
  return items.filter(function (it) {
    return String(it.casNo || '').trim() === casNo;
  });
}

function kecoName(item) {
  return String(item.sbstnNmKor || '').trim() || String(item.sbstnNm2Kor || '').split(';')[0].trim();
}

function compactName(s) {
  return String(s).replace(/\s+/g, '').toLowerCase();
}

function chemSearch(payload) {
  var query = String(payload.query || '').trim();
  if (!query) throw apiError('INVALID', '약품명이나 CAS No.를 입력해 주세요.');
  var items;
  if (isValidCas(query)) {
    items = kecoByCas(query).map(function (it) {
      return { name: kecoName(it) || query, casNo: String(it.casNo || query) };
    });
  } else {
    items = koshaByName(query);
    if (!items.length && /\s/.test(query)) items = koshaByName(query.replace(/\s+/g, ''));
  }
  var seen = {};
  var target = compactName(query);
  var rows = items.filter(function (it) {
    var key = it.name + '|' + it.casNo;
    if (!it.casNo || seen[key]) return false;
    seen[key] = true;
    return true;
  });
  var exact = rows.filter(function (it) {
    return compactName(it.name.split('(')[0]) === target;
  });
  return { items: exact.concat(rows.filter(function (it) {
    return exact.indexOf(it) < 0;
  })) };
}

var INVENTORY_CLASSES = /^(기존화학물질|등록대상기존화학물질)/;

function chemInfo(payload) {
  var casNo = String(payload.casNo || '').trim();
  if (!isValidCas(casNo)) throw apiError('INVALID', 'CAS No.가 올바르지 않습니다: ' + casNo);
  var items = kecoByCas(casNo);
  if (!items.length) return { found: false };
  var classes = [];
  var seen = {};
  var name = '';
  var formula = '';
  items.forEach(function (it) {
    if (!name) name = kecoName(it);
    if (!formula && it.mlcfrm) formula = String(it.mlcfrm).replace(/[-\s]/g, '');
    (it.typeList || []).forEach(function (t) {
      var type = String(t.sbstnClsfTypeNm || '').trim();
      var content = String(t.contInfo || '').trim();
      if (!type || INVENTORY_CLASSES.test(type) || seen[type + '|' + content]) return;
      seen[type + '|' + content] = true;
      classes.push({ type: type, content: content, exception: String(t.excpInfo || '').trim() });
    });
  });
  return { found: true, casNo: casNo, name: name, formula: formula, classes: classes };
}
