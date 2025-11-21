const express = require('express');
const router = express.Router();
const {
  createSupplier,
  getAllSuppliers,
  deleteSupplier,
  updateSupplier,
  getSupplierById,
} = require('../controller/supplierController');
const upload = require('../config/multer'); 

router.post('/', upload.array('attachments', 5), createSupplier); 
router.get('/', getAllSuppliers); // Read all
router.get('/:id', getSupplierById); 
router.put('/:id', upload.array('attachments', 5), updateSupplier); 
router.delete('/:id', deleteSupplier); // Delete

module.exports = router;