const express = require('express');
const router = express.Router();
const {createSupplier, getAllSuppliers} = require('../controller/supplierController');




router.post('/', createSupplier);  
router.get('/', getAllSuppliers);


module.exports = router;