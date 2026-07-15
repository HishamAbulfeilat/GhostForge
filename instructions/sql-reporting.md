# SQL & Reporting Instructions

## Database Standards

### Naming Conventions
```sql
-- Tables: snake_case, plural
CREATE TABLE user_orders (...)

-- Columns: snake_case
user_id, created_at, total_amount, is_active

-- Indexes: idx_[table]_[columns]
CREATE INDEX idx_orders_user_created ON orders (user_id, created_at);

-- Stored Procs: sp_[action]_[entity]
CREATE PROCEDURE sp_get_user_orders
```

### Migrations (TypeORM / Prisma / Flyway)
```sql
-- V001__create_users_table.sql (Flyway)
CREATE TABLE users (
  id          INT IDENTITY(1,1) PRIMARY KEY,
  email       NVARCHAR(255) NOT NULL UNIQUE,
  full_name   NVARCHAR(255) NOT NULL,
  is_active   BIT NOT NULL DEFAULT 1,
  created_at  DATETIME2 NOT NULL DEFAULT GETDATE(),
  updated_at  DATETIME2 NOT NULL DEFAULT GETDATE()
);
CREATE INDEX idx_users_email ON users (email);
```

## Reporting Stack

| Tool | Use Case |
|------|---------|
| **SSRS** (SQL Server Reporting Services) | Enterprise paginated reports, scheduled delivery |
| **Power BI** | Interactive dashboards, self-service BI |
| **Puppeteer** (Node.js) | PDF reports from HTML templates |
| **ExcelJS** | Excel report generation from Node.js |
| **Azure Data Factory** | ETL pipelines between data sources |
| **dbt** | SQL transformations for data warehouse |

## Report Types & Queries

### Sales Report
```sql
SELECT
  FORMAT(o.created_at, 'yyyy-MM') AS period,
  p.category,
  COUNT(DISTINCT o.id)            AS orders,
  SUM(oi.quantity)                AS units_sold,
  SUM(oi.quantity * oi.unit_price) AS revenue,
  AVG(oi.quantity * oi.unit_price) AS avg_order_value
FROM order_items oi
JOIN orders o ON o.id = oi.order_id
JOIN products p ON p.id = oi.product_id
WHERE o.status = 'completed'
  AND o.created_at BETWEEN @start_date AND @end_date
GROUP BY FORMAT(o.created_at, 'yyyy-MM'), p.category
ORDER BY period, revenue DESC;
```

### User Activity Report
```sql
SELECT
  u.id,
  u.full_name,
  u.email,
  MAX(s.created_at) AS last_login,
  COUNT(DISTINCT s.id) AS session_count,
  COUNT(DISTINCT o.id) AS order_count,
  COALESCE(SUM(o.total_amount), 0) AS lifetime_value,
  DATEDIFF(DAY, MAX(s.created_at), GETDATE()) AS days_since_login
FROM users u
LEFT JOIN sessions s ON s.user_id = u.id
LEFT JOIN orders o ON o.user_id = u.id AND o.status = 'completed'
GROUP BY u.id, u.full_name, u.email
ORDER BY lifetime_value DESC;
```

## ETL Best Practices
1. Always run ETL in transactions — rollback on failure
2. Log every run (start time, end time, rows processed, errors)
3. Use incremental loads (delta by `updated_at`) not full refreshes
4. Validate data before loading (null checks, type checks, range checks)
5. Keep raw data in staging tables, transform to warehouse tables
6. Idempotent — running ETL twice produces the same result (upsert not insert)
