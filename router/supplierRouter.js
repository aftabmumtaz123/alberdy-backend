const express = require('express');
const router = express.Router();
const {createSupplier, getAllSuppliers, deleteSupplier, updateSupplier, getSupplierById} = require('../controller/supplierController');




router.post('/', createSupplier);  
router.get('/', getAllSuppliers);
router.delete('/:id', deleteSupplier);
router.put('/:id', updateSupplier);
router.get('/:id', getSupplierById);

module.exports = router;