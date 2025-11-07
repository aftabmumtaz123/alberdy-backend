const Expense = require('../model/Expense');
const ExpenseCategory = require('../model/ExpenseCategory');
const moment = require('moment-timezone'); // For date handling





const generateExpenseId = async () => {
  try {
    const count = await Expense.countDocuments();

    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');

    const randomPart = Math.floor(100 + Math.random() * 900);

    // Example: E000123-20251023-482
    const expenseId = `E${String(count + 1).padStart(6, '0')}-${datePart}-${randomPart}`;

    return expenseId;
  } catch (error) {
    throw new Error('Failed to generate expense ID');
  }
};

// POST /api/expenses - Add Expense
exports.createExpense = async (req, res) => {
  try {
    const { expenseDate, category, amount, branch, note } = req.body;

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
      branch,
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




exports.updateExpense = async (req, res) => {
  try {
    const { id } = req.params; // this will be expenseId (custom ID)

    // Find expense using expenseId, not _id
    const expense = await Expense.findOne({ expenseId: id });
    if (!expense) {
      return res.status(404).json({ success: false, msg: "Expense not found" });
    }

    // Parse values safely
    const parsedDate = req.body.expenseDate
      ? new Date(req.body.expenseDate)
      : expense.expenseDate;

    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({ success: false, msg: "Invalid expense date" });
    }

    const parsedAmount = req.body.amount
      ? parseFloat(req.body.amount)
      : expense.amount;

    if (parsedAmount <= 0) {
      return res.status(400).json({ success: false, msg: "Amount must be greater than 0" });
    }

    // Update fields
    expense.expenseDate = parsedDate;
    expense.category = req.body.category || expense.category;
    expense.branch = req.body.branch || expense.branch;
    expense.amount = parsedAmount;
    expense.note = req.body.note || expense.note;

    await expense.save();
    await expense.populate("category", "name status branch");

    res.json({
      success: true,
      msg: "Expense updated successfully",
      data: expense,
    });
  } catch (error) {
    res.status(400).json({ success: false, msg: error.message });
  }
};






exports.getExpenses = async (req, res) => {
  try {
    const { id, category, startDate, endDate, page = 1, limit  } = req.query;
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



