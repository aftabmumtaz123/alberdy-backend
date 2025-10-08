const Expense = require('../model/Expense');
const ExpenseCategory = require('../model/ExpenseCategory');
const moment = require('moment-timezone'); // For date handling




// Helper for sequential expense ID (moved here for reliability)
const generateExpenseId = async () => {
  try {
    const count = await Expense.countDocuments(); // Simpler than db.collection
    return `E${String(count + 1).padStart(6, '0')}`;
  } catch (error) {
    console.error('ID generation error:', error);
    throw new Error('Failed to generate expense ID');
  }
};

// POST /api/expenses - Add Expense
exports.createExpense = async (req, res) => {
  try {
    const { expenseDate, category, amount, note } = req.body;

    // Validate category exists
    // const categoryDoc = await ExpenseCategory.findById(category);
    // if (!categoryDoc) {
    //   return res.status(400).json({ error: 'Category does not exist' });
    // }

    // Parse and validate expenseDate (cannot be future)
   // Parse and validate expenseDate (cannot be future)
const parsedDate = moment.tz(expenseDate, "Asia/Karachi").startOf('day').toDate();
if (!moment(parsedDate).isValid()) {
  return res.status(400).json({ error: 'Invalid expense date format' });
}

   

    // Amount >0 enforced by schema, but double-check
    const parsedAmount = parseFloat(amount);
    if (parsedAmount <= 0) {
      return res.status(400).json({ error: 'Amount must be greater than 0' });
    }

    // Generate ID explicitly
    const expenseId = await generateExpenseId();

    const expense = new Expense({
      expenseId, // Set here
      expenseDate: parsedDate,
      category,
      amount: parsedAmount,
      note
    });

    await expense.save();
    await expense.populate('category', 'name status');

    res.status(201).json({
      success: true,
      data: expense
    });
  } catch (error) {
    console.error('Create expense error:', error);
    res.status(400).json({ error: error.message });
  }
};

// PUT /api/expenses/:id - Update Expense (preserve expenseId)
exports.updateExpense = async (req, res) => {
  try {
    const { id } = req.params;
    const { expenseDate, category, amount, note } = req.body;

    // Fetch existing to preserve expenseId
    const existingExpense = await Expense.findById(id);
    if (!existingExpense) return res.status(404).json({ error: 'Expense not found' });

    // // Validate category if provided
    // if (category) {
    //   const categoryDoc = await ExpenseCategory.findById(category);
    //   if (!categoryDoc) {
    //     return res.status(400).json({ error: 'Category does not exist' });
    //   }
    // }

    // Validate expenseDate if provided
    let updateData = { note };
    if (expenseDate !== undefined) {
      const parsedDate = moment(expenseDate).toDate();
      if (!moment(parsedDate).isValid()) {
        return res.status(400).json({ error: 'Invalid expense date format' });
      }
      const today = moment().startOf('day').toDate();
      if (parsedDate > today) {
        return res.status(400).json({ error: 'Expense date cannot be in the future' });
      }
      updateData.expenseDate = parsedDate;
    }
    if (amount !== undefined) {
      const parsedAmount = parseFloat(amount);
      if (parsedAmount <= 0) {
        return res.status(400).json({ error: 'Amount must be greater than 0' });
      }
      updateData.amount = parsedAmount;
    }
    // if (category !== undefined) updateData.category = category;

    const expense = await Expense.findByIdAndUpdate(id, { $set: updateData }, { new: true, runValidators: true })
      .populate('category', 'name status');

    res.json({
      success: true,
      data: expense // expenseId preserved
    });
  } catch (error) {
    console.error('Update expense error:', error);
    res.status(400).json({ error: error.message });
  }
};





// GET /api/expenses - List Expenses (filters: id/expenseId, category, startDate, endDate)
exports.getExpenses = async (req, res) => {
  try {
    const { id, category, startDate, endDate, page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    let filter = {};
    if (id) filter.expenseId = id; // Filter by expenseId string
    if (category) filter.category = category; // By category _id
    if (startDate || endDate) {
      filter.expenseDate = {};
      if (startDate) filter.expenseDate.$gte = moment(startDate).toDate();
      if (endDate) filter.expenseDate.$lte = moment(endDate).toDate();
    }

    const [expenses, total] = await Promise.all([
      Expense.find(filter)
        .populate('category', 'name status')
        .sort({ expenseDate: -1, createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Expense.countDocuments(filter)
    ]);

    // Add SL for table display
    const slOffset = skip;
    expenses.forEach((exp, index) => {
      exp.sl = slOffset + index + 1;
    });

    res.json({
      success: true,
      data: expenses,
      pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / limit) }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// GET /api/expenses/:id - View Expense Details
exports.getExpenseById = async (req, res) => {
  try {
    const { id } = req.params; // Assumes _id, but can check expenseId if needed
    const expense = await Expense.findById(id).populate('category', 'name status');
    if (!expense) return res.status(404).json({ error: 'Expense not found' });

    res.json({
      success: true,
      data: expense
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};


// DELETE /api/expenses/:id - Delete Expense
exports.deleteExpense = async (req, res) => {
  try {
    const { id } = req.params;
    const expense = await Expense.findByIdAndDelete(id);
    if (!expense) return res.status(404).json({ error: 'Expense not found' });

    res.json({
      success: true,
      message: 'Expense deleted successfully'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};