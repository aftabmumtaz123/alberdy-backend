const express = require('express');
const router = express.Router();
const unitController = require('../controller/unitController');



const authMiddleware = require('../middleware/auth');
const requireRole = (roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, msg: 'Access denied' });
  }
  next();
};


// Unit routes
router.get('/',  unitController.getAllUnits);
router.get('/:id', unitController.getUnitById);
router.post('/', authMiddleware, requireRole(['Super Admin', 'Manager']), unitController.createUnit);
router.put('/:id', authMiddleware, requireRole(['Super Admin', 'Manager']), unitController.updateUnit);
router.delete('/:id', authMiddleware, requireRole(['Super Admin']), unitController.deleteUnit);

module.exports = router;

