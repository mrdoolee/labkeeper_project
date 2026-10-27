// Reagent columns a person fills in (stock is kept by the server).
var REAGENT_COLUMNS_INPUT = [
  'name', 'concentration', 'formula', 'casNo', 'grade', 'unit', 'mainUse', 'expiryDate', 'purchaseDate', 'openedDate',
  'maker', 'supplier', 'zoneId', 'toxic', 'accidentPrep', 'hazardManual', 'poison', 'banned', 'permitted', 'restricted', 'note',
];

// Table definitions. Code uses the keys (Users, roomId …); the spreadsheet
// shows Korean tab names and headers (SHEET_NAMES, COLUMN_LABELS).

// Columns the caller may write, per table. Every table also gets the common columns.
var TABLES = {
  Users: ['loginId', 'name', 'role', 'salt', 'hash', 'mustChangePassword', 'active'],
  Settings: ['key', 'label', 'value'],
  Rooms: ['name', 'isLab', 'note'],
  Cabinets: ['roomId', 'name', 'type', 'locked', 'rows', 'cols', 'note'],
  Zones: ['cabinetId', 'row', 'col', 'name', 'allowedClasses'],
  Reagents: REAGENT_COLUMNS_INPUT.concat(['stock']),
  ReagentTx: ['reagentId', 'reagentName', 'date', 'kind', 'amount', 'purpose', 'price', 'note'],
};

var SHEET_NAMES = { Settings: '환경설정', Users: '계정', Rooms: '교실', Cabinets: '보관장', Zones: '보관장 구역', Reagents: '시약', ReagentTx: '시약 수불' };
var TABLE_LABELS = { Settings: '환경설정', Users: '계정', Rooms: '교실', Cabinets: '보관장', Zones: '보관장 구역', Reagents: '시약', ReagentTx: '시약 수불', System: '시트' };

// Column order in a new tab: the table's readable columns, who/when, then ids and secrets.
var COMMON_VISIBLE = ['createdByName', 'createdAt', 'updatedByName', 'updatedAt', 'deleted', 'deletedByName', 'deletedAt'];
var COMMON_IDS = ['id', 'createdBy', 'updatedBy', 'deletedBy'];
var TABLE_LAYOUT = {
  Users: [['loginId', 'name', 'role', 'mustChangePassword', 'active'], ['salt', 'hash']],
  Settings: [['label', 'value'], ['key']],
  Rooms: [['name', 'isLab', 'note'], []],
  Cabinets: [['name', 'type', 'locked', 'rows', 'cols', 'note'], ['roomId']],
  Zones: [['row', 'col', 'name', 'allowedClasses'], ['cabinetId']],
  Reagents: [
    ['name', 'concentration', 'formula', 'casNo', 'grade', 'unit', 'stock', 'mainUse', 'expiryDate', 'purchaseDate', 'openedDate',
      'maker', 'supplier', 'toxic', 'accidentPrep', 'hazardManual', 'poison', 'banned', 'permitted', 'restricted', 'note'],
    ['zoneId'],
  ],
  ReagentTx: [['reagentName', 'date', 'kind', 'amount', 'purpose', 'price', 'note'], ['reagentId']],
};

var COLUMN_LABELS = {
  id: 'ID',
  createdBy: '작성자 ID',
  createdByName: '작성자',
  createdAt: '작성일시',
  updatedBy: '수정자 ID',
  updatedByName: '수정자',
  updatedAt: '수정일시',
  deleted: '삭제됨',
  deletedBy: '삭제자 ID',
  deletedByName: '삭제자',
  deletedAt: '삭제일시',
  loginId: '아이디',
  name: '이름',
  role: '역할',
  mustChangePassword: '비밀번호 변경 필요',
  active: '사용 여부',
  salt: 'salt (암호용)',
  hash: 'hash (암호용)',
  key: '항목 키',
  label: '항목',
  value: '값',
  isLab: '과학실 여부',
  note: '메모',
  type: '종류',
  locked: '잠금',
  rows: '단 수',
  cols: '칸 수',
  roomId: '교실 ID',
  row: '단',
  col: '칸',
  allowedClasses: '허용 보관 분류',
  cabinetId: '보관장 ID',
  concentration: '농도(%)',
  formula: '화학식',
  casNo: 'CAS No.',
  grade: '규격',
  unit: '단위',
  stock: '현재 보유량',
  mainUse: '주용도',
  expiryDate: '유효기간',
  purchaseDate: '구입일',
  openedDate: '개봉일',
  maker: '제조사',
  supplier: '구입처',
  zoneId: '보관 구역 ID',
  toxic: '유독물질',
  accidentPrep: '사고대비물질',
  hazardManual: '판정 직접 지정',
  poison: '독극물',
  banned: '금지물질',
  permitted: '허가물질',
  restricted: '제한물질',
  reagentId: '시약 ID',
  reagentName: '약품명',
  date: '일자',
  kind: '구분',
  amount: '수량',
  purpose: '용도',
  price: '금액(원)',
};

// Headers that differ in one table (the ledger forms call these 약품명 and 비고).
var TABLE_COLUMN_LABELS = {
  Reagents: { name: '약품명', note: '비고' },
  ReagentTx: { note: '비고' },
};

function columnLabel(table, column) {
  var own = TABLE_COLUMN_LABELS[table];
  return (own && own[column]) || COLUMN_LABELS[column];
}

var SETTING_LABELS = {
  schoolName: '학교 이름',
  managerName: '관리 교사',
  schoolLevel: '학교급',
  region: '장부 양식 지역',
  signerScienceHead: '과학부장',
  signerVicePrincipal: '교감',
  signerPrincipal: '교장',
  labOver100m2: '실험실 면적 100㎡ 이상',
  wasteDisposal: '폐수 처리 방식',
};

// History is split by area into its own tabs. Left columns are for people,
// right columns (grey header) are the raw data the app reads back.
var HISTORY_TABS = {
  settings: '환경설정 이력',
  users: '계정 이력',
  access: '접속 기록',
  rooms: '교실 이력',
  reagents: '시약 이력',
  other: '기타 이력',
};
var HISTORY_GROUP_OF_TABLE = { Settings: 'settings', System: 'settings', Users: 'users', Rooms: 'rooms', Cabinets: 'rooms', Zones: 'rooms', Reagents: 'reagents', ReagentTx: 'reagents' };
var HISTORY_COLUMNS = ['when', 'userName', 'tableLabel', 'target', 'actionLabel', 'summary', 'id', 'at', 'userId', 'table', 'recordId', 'action', 'before', 'after'];
var HISTORY_RAW_FROM = 'id';
var HISTORY_LABELS = {
  when: '일시',
  userName: '사람',
  tableLabel: '표',
  target: '대상',
  actionLabel: '동작',
  summary: '바뀐 내용',
  id: '기록 ID',
  at: '시각(원자료)',
  userId: '사람 ID',
  table: '표 키',
  recordId: '대상 ID',
  action: '동작 키',
  before: '이전 값(원자료)',
  after: '새 값(원자료)',
};
var ACTION_LABELS = {
  create: '추가',
  update: '수정',
  delete: '삭제',
  restore: '복구',
  login: '로그인',
  passwordChange: '비밀번호 변경',
  passwordReset: '비밀번호 초기화',
  close: '운영 종료',
  reopen: '운영 종료 풀기',
  continueCopy: '사본 계속 쓰기',
  startFresh: '새 학교 시트로 시작',
};
var TAB_COLORS = { data: '#2563eb', history: '#94a3b8' };
var RAW_HEADER_BACKGROUND = '#e2e8f0';

function columnsOf(table) {
  var layout = TABLE_LAYOUT[table];
  if (!layout) throw apiError('INVALID', '알 수 없는 표입니다: ' + table);
  return layout[0].concat(COMMON_VISIBLE, COMMON_IDS, layout[1]);
}

// Header text → column key. Old English headers (the key itself) are accepted too.
function keyForLabel(table, label) {
  var columns = columnsOf(table);
  for (var i = 0; i < columns.length; i++) {
    if (columnLabel(table, columns[i]) === label || columns[i] === label) return columns[i];
  }
  return null;
}

function historyKeyForLabel(label) {
  for (var i = 0; i < HISTORY_COLUMNS.length; i++) {
    if (HISTORY_LABELS[HISTORY_COLUMNS[i]] === label || HISTORY_COLUMNS[i] === label) return HISTORY_COLUMNS[i];
  }
  return null;
}

function historyGroupFor(table, action) {
  if (action === 'login') return 'access';
  return HISTORY_GROUP_OF_TABLE[table] || 'other';
}

var BOOLEAN_COLUMNS = ['deleted', 'locked', 'active', 'mustChangePassword', 'labOver100m2', 'isLab', 'hazardManual', 'poison', 'banned', 'permitted', 'restricted'];
var NUMBER_COLUMNS = ['rows', 'cols', 'row', 'col', 'concentration', 'stock', 'amount', 'price'];

// Never copied into the audit log.
var SECRET_COLUMNS = ['salt', 'hash'];

// Tables the generic records.* actions may touch, and the columns they may write.
var RECORD_TABLES = {
  Rooms: ['name', 'isLab', 'note'],
  Cabinets: ['roomId', 'name', 'type', 'locked', 'rows', 'cols', 'note'],
  Zones: ['cabinetId', 'row', 'col', 'name', 'allowedClasses'],
};

// Same ids as web/src/domain/storage.ts.
var CABINET_TYPE_IDS = ['sealed', 'flammable', 'general', 'waste', 'equipment', 'fridge'];
var STORAGE_CLASS_IDS = [
  'inorganic_acid',
  'organic_acid',
  'base',
  'reactive_inorganic',
  'metal',
  'flammable',
  'general_inorganic',
  'general_organic',
];
