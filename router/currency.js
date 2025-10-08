const express = require('express')
const router = express.Router()
const currencyController = require('../controller/currencyController')
const auth = require('../middleware/auth')



// Auth and role middleware
const requireRole = (roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, msg: 'Access denied' });
  }
  next();
};




router.post('/',  auth, requireRole(['Super Admin', 'Manager']),  currencyController.createCurrency);
router.get('/',  auth, requireRole(['Super Admin', 'Manager']),  currencyController.getAllCurrencies);
router.put('/:id',  auth, requireRole(['Super Admin', 'Manager']),  currencyController.updateCurrency);
router.delete('/:id',  auth, requireRole(['Super Admin', 'Manager']),  currencyController.deleteCurrency);

module.exports = router