const ReportController = require('../controller/reportsController');
const router = require('express').Router();

// Consolidated endpoint for all reports and analytics
// router.get('/', ReportController.getReportsAndAnalytics);

// Individual endpoints (optional, for specific use cases)
router.get('/sales', ReportController.getSalesByPeriodsData);
router.get('/most-sold', ReportController.getMostSoldProductsData);
router.get('/orders-by-status', ReportController.getOrdersByStatusData);
router.get('/low-stock', ReportController.getLowStockProductsData);
router.get('/expired', ReportController.getExpiredProductsData);
router.get('/revenue-by-category', ReportController.getRevenueByCategoryData);

module.exports = router;

