CREATE TABLE counters (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  total_visits INTEGER NOT NULL DEFAULT 0 CHECK (total_visits >= 0)
);

INSERT INTO counters (id) VALUES (1);

CREATE TABLE visitors (
  visitor_key BLOB PRIMARY KEY CHECK (length(visitor_key) = 32)
) STRICT, WITHOUT ROWID;
