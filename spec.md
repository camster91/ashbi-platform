# Finance Dashboard (QuickBooks Clone) Feature

We need to add a comprehensive Finance Dashboard and Expense tracking to `hub.ashbi.ca` (the Ashbi-Design repo). 

## 1. Backend Routes
Create `src/routes/expense.routes.js` (mirroring the style of `invoice.routes.js`):
- `GET /api/expenses`
- `POST /api/expenses` (create expense)
- `PUT /api/expenses/:id`
- `DELETE /api/expenses/:id`
Make sure to register it in `src/index.js` as `fastify.register(expenseRoutes, { prefix: '/api/expenses' })`.

## 2. Finance Dashboard UI (`web/src/pages/FinanceDashboard.jsx`)
Create a new page that shows:
- Top metrics: Total Revenue, Total Expenses, Net Profit (Net Income).
- Two tabs or sections: 
  - **Expenses:** A table of expenses (fetched from `/api/expenses`) with an "Add Expense" modal.
  - **Invoices/Revenue:** A summary of invoices (you can reuse the `Invoices` table logic or just show top unpaid invoices).
- Add the route to `web/src/App.jsx` under `/finance`.

## 3. Sidebar Navigation (`web/src/components/Layout.jsx` or similar)
Add a "Finance" or "Accounting" link in the sidebar that points to `/finance`.

Make sure to test the build (`cd web && npm run build`) after adding the React components.
