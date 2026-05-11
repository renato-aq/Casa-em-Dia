# Casa em Dia

Minimal MVP foundation API for:
- auth (register/login/logout)
- household creation
- invite creation/acceptance
- resident listing with role/status
- financial core (bills, expenses, settlements, monthly close)
- reporting/utilities (dashboard, bill receipts, subscriptions, export)

## Run tests

```bash
npm test
```

## Run server

```bash
node src/server.js
```

## Reporting export format

Endpoint: `GET /households/:householdId/reports/export?format=excel`

- Returns `text/csv` (Excel-compatible CSV)
- Columns: `section,metric,value`
- Current rows include:
  - `totals`: monthly expenses, paid bills, subscriptions, upcoming due, overdue due
  - `counts`: pending, overdue, and paid bill counts
