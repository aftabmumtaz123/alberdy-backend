const ReportController = require('../controller/reportsController');
const router = require('express').Router();

// Consolidated endpoint for all reports and analytics
// router.get('/', ReportController.getReportsAndAnalytics);

// Individual endpoints (optional, for specific use cases)
router.get('/sales', ReportController.getSalesByPeriods);
router.get('/most-sold', ReportController.getMostSoldProducts);
router.get('/orders-by-status', ReportController.getOrdersByStatus);
router.get('/low-stock', ReportController.getLowStockProducts);
router.get('/expired', ReportController.getExpiredProducts);
router.get('/revenue-by-category', ReportController.getRevenueByCategory);

module.exports = router;

