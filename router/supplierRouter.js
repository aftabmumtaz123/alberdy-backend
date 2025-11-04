const express = require('express');
const router = express.Router();
const {createSupplier} = require('../controller/supplierController');




router.post('/', createSupplier);  


module.exports = router;