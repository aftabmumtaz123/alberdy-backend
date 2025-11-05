const express = require('express');
const router = express.Router();
const {createSupplier, getAllSuppliers, deleteSupplier} = require('../controller/supplierController');




router.post('/', createSupplier);  
router.get('/', getAllSuppliers);
router.delete('/:id', deleteSupplier);

module.exports = router;