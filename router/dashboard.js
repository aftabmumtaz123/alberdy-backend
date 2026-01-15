const express = require('express');
const router = express.Router();
const dashboardController = require('../controller/dashboardController');
const auth = require('../middleware/auth');

router.get('/', auth, dashboardController.getDashboard);
router.get('/revenue/year/:year', auth, dashboardController.getRevenueChart);
router.get('/sales-trend/year/:year', auth, dashboardController.getSalesTrend);
router.get('/customer-growth/year/:year', auth, dashboardController.getCustomerGrowth);


module.exports = router;