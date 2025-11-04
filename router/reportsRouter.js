const ReportController = require('../controller/reportsController');
const router = require('express').Router();

router.get('/sales', ReportController.getSalesReport);
router.get('/most-sold', ReportController.getMostSoldProducts);
router.get('/orders-by-status', ReportController.getOrdersByStatus);
router.get('/low-stock', ReportController.getLowStockProducts);
router.get('/expired', ReportController.getExpiredProducts);
router.get('/revenue-by-category', ReportController.getRevenueByCategory);

module.exports = router;