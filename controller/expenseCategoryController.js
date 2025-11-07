const ExpenseCategory = require('../model/ExpenseCategory');

// POST /api/expense-categories - Add Category
exports.createCategory = async (req, res) => {
  try {
    const { name, status } = req.body;

    const category = new ExpenseCategory({
      name,
      status: status || 'active'
    });

    await category.save();

    res.status(201).json({
      success: true,
      data: category
    });
  } catch (error) {
    res.status(400).json({ error: error.message }); // e.g., duplicate name
  }
};

// GET /api/expense-categories - List Categories (filter: status)
exports.getCategories = async (req, res) => {
  try {
    const { status = 'all', page = 1, limit  } = req.query;

    // Convert pagination params to numbers
    const pageNum = Math.max(parseInt(page, 10), 1);
    const limitNum = Math.max(parseInt(limit, 10), 1);

    // Filtering logic
    let filter = {};
    if (status && status !== 'all') filter.status = status;

    // Get total count (for pagination info)
    const totalCategories = await ExpenseCategory.countDocuments(filter);

    // Fetch paginated categories
    const categories = await ExpenseCategory.find(filter)
      .sort({ name: 1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum);

    res.json({
      success: true,
      data: categories,
      pagination: {
        total: totalCategories,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(totalCategories / limitNum),
        hasNextPage: pageNum * limitNum < totalCategories,
        hasPrevPage: pageNum > 1
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};


// PUT /api/expense-categories/:id - Update Category
exports.updateCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, status } = req.body;

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (status !== undefined) updateData.status = status;

    const category = await ExpenseCategory.findByIdAndUpdate(id, { $set: updateData }, { new: true, runValidators: true });

    if (!category) return res.status(404).json({ error: 'Category not found' });

    res.json({
      success: true,
      data: category
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// DELETE /api/expense-categories/:id - Delete Category
exports.deleteCategory = async (req, res) => {
  try {
    const { id } = req.params;

    // Optional: Check if used in expenses
    const expenseCount = await Expense.countDocuments({ category: id });
    if (expenseCount > 0) {
      return res.status(400).json({ error: 'Cannot delete category in use by expenses' });
    }

    const category = await ExpenseCategory.findByIdAndDelete(id);
    if (!category) return res.status(404).json({ error: 'Category not found' });

    res.json({
      success: true,
      message: 'Category deleted successfully'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};