const express = require('express');
const router = express.Router();
const expenseCategoryController = require('../controller/expenseCategoryController');
const auth = require('../middleware/auth');

router.post('/',  auth,  expenseCategoryController.createCategory);
router.get('/',  auth,  expenseCategoryController.getCategories);
router.put('/:id',  auth,  expenseCategoryController.updateCategory);
router.delete('/:id',  auth,  expenseCategoryController.deleteCategory);

module.exports = router;