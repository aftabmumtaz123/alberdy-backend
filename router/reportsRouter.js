// routes/reports.js
const express = require('express');
const router = express.Router();
const ReportController = require('../controllers/ReportController');
const authMiddleware = require('../middleware/auth');
const requireRole = roles => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, msg: 'Access denied' });
  }
  next();
};

router.use(authMiddleware, requireRole(['Super Admin', 'Manager']));

router.get('/profit-loss', ReportController.getProfitLossReport);
router.get('/top-customers', ReportController.getTopCustomersPnL);
router.get('/top-products', ReportController.getTopProductsPnL);
router.get('/sales-by-periods', ReportController.getSalesByPeriods);
router.get('/most-sold', ReportController.getMostSoldProducts);
router.get('/orders-by-status', ReportController.getOrdersByStatus);
router.get('/low-stock', ReportController.getLowStockProducts);
router.get('/expired-products', ReportController.getExpiredProducts);
router.get('/revenue-by-category', ReportController.getRevenueByCategory);

module.exports = router;