// Table definitions. Every table except AuditLog also gets COMMON_COLUMNS.

var COMMON_COLUMNS = ['id', 'createdBy', 'createdAt', 'updatedBy', 'updatedAt', 'deleted', 'deletedBy', 'deletedAt'];

var TABLES = {
  Users: ['loginId', 'name', 'role', 'salt', 'hash', 'mustChangePassword', 'active'],
  Settings: ['key', 'value'],
  Rooms: ['name', 'isLab', 'note'],
  Cabinets: ['roomId', 'name', 'type', 'locked', 'rows', 'cols', 'note'],
  Zones: ['cabinetId', 'row', 'col', 'name', 'allowedClasses'],
};

var AUDIT_COLUMNS = ['id', 'at', 'userId', 'userName', 'table', 'recordId', 'action', 'before', 'after'];

var BOOLEAN_COLUMNS = ['deleted', 'locked', 'active', 'mustChangePassword', 'labOver100m2', 'isLab'];
var NUMBER_COLUMNS = ['rows', 'cols', 'row', 'col'];

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
