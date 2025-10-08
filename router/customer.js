const express = require('express');
const router = express.Router();



const { getAllCustomers, getCustomerById, updateCustomer, deleteCustomer, createCustomer } = require('../controller/customerController');


// Auth and role middleware
const authMiddleware = require('../middleware/auth');
const requireRole = (roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, msg: 'Access denied' });
  }
  next();
};

// Customer routes
router.get('/customers', authMiddleware, requireRole(['Super Admin', 'Manager', 'Staff']), getAllCustomers);
router.get('/customers/:id', authMiddleware, requireRole(['Super Admin', 'Manager', 'Staff']), getCustomerById);
router.post('/customers', authMiddleware, requireRole(['Super Admin', 'Manager', 'Staff']), createCustomer);
router.put('/customers/:id', authMiddleware, requireRole(['Super Admin', 'Manager', 'Staff']), updateCustomer);
router.delete('/customers/:id', authMiddleware, requireRole(['Super Admin', 'Manager', 'Staff']), deleteCustomer);


module.exports = router;
