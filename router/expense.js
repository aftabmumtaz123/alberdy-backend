const express = require('express');
const router = express.Router();
const expenseController = require('../controller/expenseController');
const auth = require('../middleware/auth');
const requireRole = (roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, msg: 'Access denied' });
  }
  next();
};

router.post('/',  auth,  requireRole(['Super Admin', 'Manager']), expenseController.createExpense);
router.get('/',  auth,  requireRole(['Super Admin', 'Manager']), expenseController.getExpenses);
router.get('/:id',  auth,  requireRole(['Super Admin', 'Manager']), expenseController.getExpenseById);
router.put('/:id',  auth,  requireRole(['Super Admin', 'Manager']), expenseController.updateExpense );
router.delete('/:id',  auth,  requireRole(['Super Admin', 'Manager']), expenseController.deleteExpense);


module.exports = router;
