// routes/supplierRouter.js
const express = require('express');
const router = express.Router();

const {
  createSupplier,
  getAllSuppliers,
  getSupplierById,
  updateSupplier,
  deleteSupplier,
} = require('../controllers/supplierController');

const { uploadCreate, uploadUpdate } = require('../config/multer');

// CREATE – you can keep 'attachments' here
router.post('/', uploadCreate.array('attachments', 5), createSupplier);

// READ
router.get('/', getAllSuppliers);
router.get('/:id', getSupplierById);

// UPDATE – NEW FIELD NAME 'files' → no conflict!
router.put('/:id', uploadUpdate.array('files', 10), updateSupplier);

// DELETE
router.delete('/:id', deleteSupplier);

module.exports = router;