const express = require('express');
const router = express.Router();
const {createSupplier} = require('../controller/supplierController');




router.post('/suppliers', createSupplier);  


module.exports = router;