# SQL Report Generation Prompts

Use these prompts with the `/sql report` command.

---

## Business Reports

### Sales Summary
```
Generate a SQL report showing:
- Total revenue by month for the last 12 months
- Breakdown by product category
- Top 10 products by revenue
- Month-over-month growth percentage
Database: [MSSQL/PostgreSQL]
Tables: orders, order_items, products
Export format: PDF + Excel
```

### User Engagement
```
Generate a user engagement report:
- Daily/weekly/monthly active users
- New users vs returning users
- Average session duration
- Top actions/features used
- Churn risk (users inactive > 30 days)
Database: [type]
Tables: users, sessions, events
```

### KPI Dashboard Data
```
Generate SQL queries for a KPI dashboard:
- Total orders today / this week / this month
- Revenue today vs same day last month
- Active users today
- Conversion rate (visits → orders)
- Average order value
All queries should run in < 1 second.
```

---

## ETL Prompts

### Data Migration
```
Create an ETL script to migrate data:
- Source: [old database / file / API]
- Target: [new database / warehouse]
- Transform: [describe transformations needed]
- Handle duplicates: [upsert / skip / overwrite]
- Schedule: [one-time / daily / hourly]
```

### Data Warehouse Load
```
Create a dbt model to transform:
- Source tables: [list tables]
- Target: [fact/dimension table name]
- Grain: [one row per order / per day per user / etc.]
- Metrics to calculate: [revenue, count, avg, etc.]
- Incremental or full refresh?
```

---

## Schema Design Prompts

### New Feature Schema
```
Design a database schema for:
- Feature: [describe the feature]
- Entities: [list main entities]
- Relationships: [describe relationships]
- Database: [MSSQL/PostgreSQL]
Include: table DDL, indexes, foreign keys, migration script
```
