CREATE TABLE IF NOT EXISTS licenses (
  id TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL UNIQUE,
  key_suffix TEXT NOT NULL,
  client_label TEXT NOT NULL,
  created_at TEXT NOT NULL,
  activated_at TEXT,
  device_hash TEXT,
  recovery_public_key TEXT,
  name TEXT NOT NULL DEFAULT '', username TEXT NOT NULL DEFAULT '', store_name TEXT NOT NULL DEFAULT '',
  CHECK ((activated_at IS NULL AND device_hash IS NULL) OR
         (activated_at IS NOT NULL AND device_hash IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS recovery_owners (
 installation_id TEXT PRIMARY KEY, device_hash TEXT NOT NULL, public_key TEXT NOT NULL,
 license_id TEXT, owner_id TEXT NOT NULL, name TEXT NOT NULL, username TEXT NOT NULL,
 store_name TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS recovery_codes (
 installation_id TEXT PRIMARY KEY, code_hash TEXT NOT NULL UNIQUE, kind TEXT NOT NULL,
 expires_at INTEGER NOT NULL, request_id TEXT, redeemed_at INTEGER,
 name TEXT NOT NULL DEFAULT '', username TEXT NOT NULL DEFAULT '', store_name TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS recovery_enrollments (
 installation_id TEXT PRIMARY KEY, device_hash TEXT NOT NULL, public_key TEXT NOT NULL,
 code_hash TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL,
 name TEXT NOT NULL DEFAULT '', username TEXT NOT NULL DEFAULT '', store_name TEXT NOT NULL DEFAULT ''
);

CREATE TRIGGER IF NOT EXISTS recovery_owner_labels_insert
AFTER INSERT ON recovery_owners BEGIN
 UPDATE recovery_codes SET name=NEW.name,username=NEW.username,store_name=NEW.store_name WHERE installation_id=NEW.installation_id;
 UPDATE recovery_enrollments SET name=NEW.name,username=NEW.username,store_name=NEW.store_name WHERE installation_id=NEW.installation_id;
 UPDATE licenses SET name=NEW.name,username=NEW.username,store_name=NEW.store_name
 WHERE id=NEW.license_id OR (NEW.license_id IS NULL AND device_hash=NEW.device_hash AND (SELECT COUNT(*) FROM recovery_owners WHERE device_hash=NEW.device_hash)=1);
END;

CREATE TRIGGER IF NOT EXISTS recovery_owner_labels_update
AFTER UPDATE OF name,username,store_name ON recovery_owners BEGIN
 UPDATE recovery_codes SET name=NEW.name,username=NEW.username,store_name=NEW.store_name WHERE installation_id=NEW.installation_id;
 UPDATE recovery_enrollments SET name=NEW.name,username=NEW.username,store_name=NEW.store_name WHERE installation_id=NEW.installation_id;
 UPDATE licenses SET name=NEW.name,username=NEW.username,store_name=NEW.store_name
 WHERE id=NEW.license_id OR (NEW.license_id IS NULL AND device_hash=NEW.device_hash AND (SELECT COUNT(*) FROM recovery_owners WHERE device_hash=NEW.device_hash)=1);
END;

CREATE TRIGGER IF NOT EXISTS recovery_codes_labels_insert AFTER INSERT ON recovery_codes
WHEN EXISTS(SELECT 1 FROM recovery_owners WHERE installation_id=NEW.installation_id)
BEGIN
 UPDATE recovery_codes SET
 name=(SELECT name FROM recovery_owners WHERE installation_id=NEW.installation_id),
 username=(SELECT username FROM recovery_owners WHERE installation_id=NEW.installation_id),
 store_name=(SELECT store_name FROM recovery_owners WHERE installation_id=NEW.installation_id)
 WHERE installation_id=NEW.installation_id;
END;

CREATE TRIGGER IF NOT EXISTS recovery_enrollments_labels_insert AFTER INSERT ON recovery_enrollments
WHEN EXISTS(SELECT 1 FROM recovery_owners WHERE installation_id=NEW.installation_id)
BEGIN
 UPDATE recovery_enrollments SET
 name=(SELECT name FROM recovery_owners WHERE installation_id=NEW.installation_id),
 username=(SELECT username FROM recovery_owners WHERE installation_id=NEW.installation_id),
 store_name=(SELECT store_name FROM recovery_owners WHERE installation_id=NEW.installation_id)
 WHERE installation_id=NEW.installation_id;
END;

CREATE TRIGGER IF NOT EXISTS recovery_codes_labels_reissue AFTER UPDATE OF code_hash ON recovery_codes
WHEN EXISTS(SELECT 1 FROM recovery_owners WHERE installation_id=NEW.installation_id)
BEGIN
 UPDATE recovery_codes SET
 name=(SELECT name FROM recovery_owners WHERE installation_id=NEW.installation_id),
 username=(SELECT username FROM recovery_owners WHERE installation_id=NEW.installation_id),
 store_name=(SELECT store_name FROM recovery_owners WHERE installation_id=NEW.installation_id)
 WHERE installation_id=NEW.installation_id;
END;
CREATE TRIGGER IF NOT EXISTS recovery_enrollments_labels_reissue AFTER UPDATE OF code_hash ON recovery_enrollments
WHEN EXISTS(SELECT 1 FROM recovery_owners WHERE installation_id=NEW.installation_id)
BEGIN
 UPDATE recovery_enrollments SET
 name=(SELECT name FROM recovery_owners WHERE installation_id=NEW.installation_id),
 username=(SELECT username FROM recovery_owners WHERE installation_id=NEW.installation_id),
 store_name=(SELECT store_name FROM recovery_owners WHERE installation_id=NEW.installation_id)
 WHERE installation_id=NEW.installation_id;
END;

-- Backfill existing rows and use the administrator label for an unactivated key's shop.
UPDATE licenses SET store_name=client_label WHERE store_name='';
UPDATE recovery_owners SET name=name;
