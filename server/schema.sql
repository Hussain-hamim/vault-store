PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,username TEXT NOT NULL COLLATE NOCASE UNIQUE,password TEXT NOT NULL,role TEXT NOT NULL,permissions TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS parties(id TEXT PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN ('customer','supplier')),name TEXT NOT NULL,phone TEXT NOT NULL DEFAULT '',email TEXT NOT NULL DEFAULT '',address TEXT NOT NULL DEFAULT '',credit_limit INTEGER NOT NULL DEFAULT 0,walk_in INTEGER NOT NULL DEFAULT 0,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY,sku TEXT NOT NULL UNIQUE,barcode TEXT NOT NULL DEFAULT '',name TEXT NOT NULL,brand TEXT NOT NULL,model TEXT NOT NULL,category TEXT NOT NULL,price INTEGER NOT NULL CHECK(price>=0),minimum INTEGER NOT NULL DEFAULT 0,reorder_level INTEGER NOT NULL DEFAULT 5,location TEXT NOT NULL DEFAULT '',condition TEXT NOT NULL DEFAULT 'New',warranty TEXT NOT NULL DEFAULT '',attributes TEXT NOT NULL DEFAULT '{}',serialized INTEGER NOT NULL DEFAULT 0,stock INTEGER NOT NULL DEFAULT 0 CHECK(stock>=0),active INTEGER NOT NULL DEFAULT 1,image TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_barcode ON products(barcode) WHERE barcode<>'';
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name COLLATE NOCASE,id);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category,active,id);
CREATE INDEX IF NOT EXISTS idx_products_reorder ON products((stock=0) DESC,sku,id) WHERE active=1 AND stock<=reorder_level;
CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,number TEXT NOT NULL UNIQUE,kind TEXT NOT NULL,party_id TEXT REFERENCES parties(id),date TEXT NOT NULL,total INTEGER NOT NULL DEFAULT 0,paid INTEGER NOT NULL DEFAULT 0,cost INTEGER NOT NULL DEFAULT 0,discount INTEGER NOT NULL DEFAULT 0,note TEXT NOT NULL DEFAULT '',category TEXT NOT NULL DEFAULT '',original_id TEXT REFERENCES documents(id),due_date TEXT,request_key TEXT NOT NULL UNIQUE,user_id TEXT REFERENCES users(id),created_at TEXT NOT NULL) STRICT;
CREATE INDEX IF NOT EXISTS idx_documents_date ON documents(date,kind,id);
CREATE INDEX IF NOT EXISTS idx_documents_party ON documents(party_id,date,id);
CREATE INDEX IF NOT EXISTS idx_documents_original ON documents(original_id);
CREATE TABLE IF NOT EXISTS document_lines(id TEXT PRIMARY KEY,document_id TEXT NOT NULL REFERENCES documents(id),product_id TEXT NOT NULL REFERENCES products(id),quantity INTEGER NOT NULL CHECK(quantity>0),price INTEGER NOT NULL CHECK(price>=0),cost INTEGER NOT NULL DEFAULT 0,discount INTEGER NOT NULL DEFAULT 0,original_line_id TEXT REFERENCES document_lines(id)) STRICT;
CREATE INDEX IF NOT EXISTS idx_lines_document ON document_lines(document_id);
CREATE INDEX IF NOT EXISTS idx_lines_product ON document_lines(product_id,document_id);
CREATE INDEX IF NOT EXISTS idx_lines_original ON document_lines(original_line_id);
CREATE TABLE IF NOT EXISTS batches(id TEXT PRIMARY KEY,product_id TEXT NOT NULL REFERENCES products(id),line_id TEXT REFERENCES document_lines(id),quantity INTEGER NOT NULL,remaining INTEGER NOT NULL CHECK(remaining>=0 AND remaining<=quantity),unit_cost INTEGER NOT NULL CHECK(unit_cost>=0),received_at TEXT NOT NULL) STRICT;
CREATE INDEX IF NOT EXISTS idx_batches_fifo ON batches(product_id,received_at,id) WHERE remaining>0;
CREATE INDEX IF NOT EXISTS idx_batches_history ON batches(product_id,received_at);
CREATE INDEX IF NOT EXISTS idx_batches_line ON batches(line_id);
CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY,product_id TEXT NOT NULL REFERENCES products(id),batch_id TEXT NOT NULL REFERENCES batches(id),serial TEXT NOT NULL UNIQUE,imei1 TEXT NOT NULL DEFAULT '',imei2 TEXT NOT NULL DEFAULT '',status TEXT NOT NULL CHECK(status IN ('in_stock','sold','returned_supplier')),sale_line_id TEXT REFERENCES document_lines(id)) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_imei1 ON devices(imei1) WHERE imei1<>'';
CREATE UNIQUE INDEX IF NOT EXISTS idx_imei2 ON devices(imei2) WHERE imei2<>'';
CREATE INDEX IF NOT EXISTS idx_devices_product ON devices(product_id,status);
CREATE TABLE IF NOT EXISTS allocations(id TEXT PRIMARY KEY,line_id TEXT NOT NULL REFERENCES document_lines(id),batch_id TEXT NOT NULL REFERENCES batches(id),quantity INTEGER NOT NULL,cost INTEGER NOT NULL,returned INTEGER NOT NULL DEFAULT 0 CHECK(returned>=0 AND returned<=quantity)) STRICT;
CREATE INDEX IF NOT EXISTS idx_allocations_line ON allocations(line_id);
CREATE TABLE IF NOT EXISTS movements(id TEXT PRIMARY KEY,document_id TEXT NOT NULL REFERENCES documents(id),product_id TEXT NOT NULL REFERENCES products(id),quantity INTEGER NOT NULL,cost INTEGER NOT NULL,date TEXT NOT NULL) STRICT;
CREATE INDEX IF NOT EXISTS idx_movements_product ON movements(product_id,date,id);
CREATE TABLE IF NOT EXISTS journal(id TEXT PRIMARY KEY,document_id TEXT NOT NULL REFERENCES documents(id),account TEXT NOT NULL,party_id TEXT REFERENCES parties(id),debit INTEGER NOT NULL DEFAULT 0 CHECK(debit>=0),credit INTEGER NOT NULL DEFAULT 0 CHECK(credit>=0),date TEXT NOT NULL,CHECK((debit=0) OR (credit=0))) STRICT;
CREATE INDEX IF NOT EXISTS idx_journal_date ON journal(date,account);
CREATE INDEX IF NOT EXISTS idx_journal_account ON journal(account,date,id);
CREATE INDEX IF NOT EXISTS idx_journal_party ON journal(party_id,account,date,id);
CREATE TABLE IF NOT EXISTS payment_allocations(id TEXT PRIMARY KEY,payment_id TEXT NOT NULL REFERENCES documents(id),invoice_id TEXT NOT NULL REFERENCES documents(id),amount INTEGER NOT NULL CHECK(amount>0)) STRICT;
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id TEXT REFERENCES users(id),action TEXT NOT NULL,entity_id TEXT NOT NULL,details TEXT NOT NULL,created_at TEXT NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS backup_runs(id TEXT PRIMARY KEY,created_at TEXT NOT NULL,path TEXT NOT NULL,status TEXT NOT NULL,checksum TEXT NOT NULL DEFAULT '',size INTEGER NOT NULL DEFAULT 0,message TEXT NOT NULL DEFAULT '') STRICT;
PRAGMA user_version=2;
CREATE TABLE IF NOT EXISTS daily_totals(date TEXT NOT NULL,account TEXT NOT NULL,debit INTEGER NOT NULL DEFAULT 0,credit INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(date,account)) WITHOUT ROWID, STRICT;
CREATE TRIGGER IF NOT EXISTS journal_daily_insert AFTER INSERT ON journal BEGIN
 INSERT INTO daily_totals(date,account,debit,credit) VALUES(NEW.date,NEW.account,NEW.debit,NEW.credit)
 ON CONFLICT(date,account) DO UPDATE SET debit=debit+NEW.debit,credit=credit+NEW.credit;
END;
CREATE TABLE IF NOT EXISTS sequences(name TEXT PRIMARY KEY,value INTEGER NOT NULL) STRICT;

CREATE TABLE IF NOT EXISTS party_totals(party_id TEXT NOT NULL REFERENCES parties(id),account TEXT NOT NULL,debit INTEGER NOT NULL DEFAULT 0,credit INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(party_id,account)) WITHOUT ROWID, STRICT;
CREATE TRIGGER IF NOT EXISTS journal_party_insert AFTER INSERT ON journal WHEN NEW.party_id IS NOT NULL BEGIN
 INSERT INTO party_totals(party_id,account,debit,credit) VALUES(NEW.party_id,NEW.account,NEW.debit,NEW.credit)
 ON CONFLICT(party_id,account) DO UPDATE SET debit=debit+NEW.debit,credit=credit+NEW.credit;
END;
CREATE TABLE IF NOT EXISTS document_product_snapshots(line_id TEXT PRIMARY KEY REFERENCES document_lines(id),name TEXT NOT NULL,sku TEXT NOT NULL,brand TEXT NOT NULL,model TEXT NOT NULL,attributes TEXT NOT NULL,image TEXT NOT NULL,serialized INTEGER NOT NULL) STRICT;
CREATE TRIGGER IF NOT EXISTS document_line_snapshot AFTER INSERT ON document_lines BEGIN
 INSERT INTO document_product_snapshots(line_id,name,sku,brand,model,attributes,image,serialized)
 SELECT NEW.id,COALESCE(s.name,p.name),COALESCE(s.sku,p.sku),COALESCE(s.brand,p.brand),COALESCE(s.model,p.model),COALESCE(s.attributes,p.attributes),COALESCE(s.image,p.image),COALESCE(s.serialized,p.serialized)
 FROM products p LEFT JOIN document_product_snapshots s ON s.line_id=NEW.original_line_id WHERE p.id=NEW.product_id;
END;

CREATE TRIGGER IF NOT EXISTS journal_daily_delete AFTER DELETE ON journal BEGIN
 UPDATE daily_totals SET debit=debit-OLD.debit,credit=credit-OLD.credit WHERE date=OLD.date AND account=OLD.account;
END;
CREATE TRIGGER IF NOT EXISTS journal_party_delete AFTER DELETE ON journal WHEN OLD.party_id IS NOT NULL BEGIN
 UPDATE party_totals SET debit=debit-OLD.debit,credit=credit-OLD.credit WHERE party_id=OLD.party_id AND account=OLD.account;
END;
CREATE TABLE IF NOT EXISTS invoice_revisions(document_id TEXT PRIMARY KEY REFERENCES documents(id),revision INTEGER NOT NULL DEFAULT 0) STRICT;
CREATE TABLE IF NOT EXISTS invoice_operations(request_key TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),action TEXT NOT NULL,result TEXT NOT NULL) STRICT;

CREATE TABLE IF NOT EXISTS expense_accounts(id TEXT PRIMARY KEY,name TEXT NOT NULL COLLATE NOCASE UNIQUE,created_at TEXT NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS consignment_payout_allocations(id TEXT PRIMARY KEY,payment_id TEXT NOT NULL REFERENCES documents(id),sale_id TEXT NOT NULL REFERENCES documents(id),owner_id TEXT NOT NULL REFERENCES parties(id),amount INTEGER NOT NULL CHECK(amount>0)) STRICT;
CREATE INDEX IF NOT EXISTS idx_consignment_payout_sale ON consignment_payout_allocations(sale_id,owner_id);

CREATE INDEX IF NOT EXISTS idx_party_totals_account ON party_totals(account,party_id);

-- Product thumbnails are content-addressed BLOBs so catalog pages remain small.
CREATE TABLE IF NOT EXISTS product_photos(id TEXT PRIMARY KEY,mime TEXT NOT NULL,data BLOB NOT NULL,created_at TEXT NOT NULL) STRICT;
CREATE INDEX IF NOT EXISTS idx_product_photo_match ON products(category,brand COLLATE NOCASE,model COLLATE NOCASE) WHERE substr(image,1,6)='photo:';

-- Product drafts are private to one account in this shop and are not inventory.
CREATE TABLE IF NOT EXISTS product_drafts(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),intent TEXT NOT NULL CHECK(intent IN ('catalog','purchase')),data TEXT NOT NULL,image TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL) STRICT;
CREATE INDEX IF NOT EXISTS idx_product_drafts_user ON product_drafts(user_id,intent,updated_at DESC,id DESC);
CREATE TABLE IF NOT EXISTS product_entry_operations(user_id TEXT NOT NULL REFERENCES users(id),request_key TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(user_id,request_key)) STRICT;

-- Historical returns/reversals must never leave positive stock hidden from inventory.
CREATE TRIGGER IF NOT EXISTS product_stock_reactivate AFTER UPDATE OF stock ON products
WHEN NEW.stock>0 AND NEW.active=0 BEGIN
  UPDATE products SET active=1 WHERE id=NEW.id;
END;

CREATE TABLE IF NOT EXISTS inventory_units(
 id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, product_id TEXT NOT NULL REFERENCES products(id),
 batch_id TEXT NOT NULL REFERENCES batches(id), serial TEXT, condition TEXT NOT NULL DEFAULT 'New',
 battery TEXT NOT NULL DEFAULT '',notes TEXT NOT NULL DEFAULT '',accessories TEXT NOT NULL DEFAULT '',
 price INTEGER NOT NULL DEFAULT 0 CHECK(price>=0),status TEXT NOT NULL CHECK(status IN ('available','sold','returned_supplier','adjusted_out')),
 sale_line_id TEXT REFERENCES document_lines(id)
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_unit_serial_ci ON inventory_units(serial COLLATE NOCASE) WHERE serial IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_unit_available ON inventory_units(product_id,status);
CREATE INDEX IF NOT EXISTS idx_unit_batch ON inventory_units(batch_id,status);
CREATE INDEX IF NOT EXISTS idx_unit_sale ON inventory_units(sale_line_id);
CREATE TABLE IF NOT EXISTS unit_lines(line_id TEXT NOT NULL REFERENCES document_lines(id),unit_id TEXT NOT NULL REFERENCES inventory_units(id),kind TEXT NOT NULL,snapshot TEXT NOT NULL,PRIMARY KEY(line_id,unit_id)) STRICT;
