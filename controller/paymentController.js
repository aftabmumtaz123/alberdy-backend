const Payment = require('../model/Payment');
const Supplier = require('../model/Supplier');

// Create a new payment
exports.createPayment = async (req, res) => {
  try {
    const { supplier_id, amountPaid, amountDue, payment_method, date, notes } = req.body;

    // Validate input
    if (!supplier_id || !amountPaid || !payment_method) {
      return res.status(400).json({
        success: false,
        message: 'Supplier ID, amount paid, and payment method are required',
      });
    }

    // Check if supplier exists
    const supplier = await Supplier.findById(supplier_id);
    if (!supplier) {
      return res.status(404).json({
        success: false,
        message: 'Supplier not found',
      });
    }

    // Validate amountPaid
    if (amountPaid <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Amount paid must be greater than zero',
      });
    }

    // Validate amountDue (if provided)
    if (amountDue !== undefined && amountDue < 0) {
      return res.status(400).json({
        success: false,
        message: 'Amount due cannot be negative',
      });
    }

    // Validate payment method
    const allowedMethods = ['Bank Transfer', 'Credit Card', 'Cash', 'Check', 'Other'];
    if (!allowedMethods.includes(payment_method)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payment method',
      });
    }

    // Create payment
    const payment = new Payment({
      supplier: supplier_id,
      amountPaid,
      amountDue,
      paymentMethod: payment_method,
      date: date || Date.now(),
      notes,
    });

    await payment.save();

    // Update supplier's payment history
    await Supplier.findByIdAndUpdate(
      supplier_id,
      { $push: { paymentHistory: payment._id } },
      { new: true }
    );

    res.status(201).json({
      success: true,
      message: 'Payment created successfully',
      data: payment,
    });
  } catch (error) {
    console.error('Create Payment Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while creating payment',
      error: error.message,
    });
  }
};

// Edit a payment
exports.updatePayment = async (req, res) => {
  try {
    const { id } = req.params;
    const { supplier_id, amountPaid, amountDue, payment_method, date, notes } = req.body;

    // Check if payment exists
    const payment = await Payment.findById(id);
    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found',
      });
    }

    // Validate supplier if provided
    if (supplier_id) {
      const supplier = await Supplier.findById(supplier_id);
      if (!supplier) {
        return res.status(404).json({
          success: false,
          message: 'Supplier not found',
        });
      }
    }

    // Validate amountPaid if provided
    if (amountPaid && amountPaid <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Amount paid must be greater than zero',
      });
    }

    // Validate amountDue if provided
    if (amountDue !== undefined && amountDue < 0) {
      return res.status(400).json({
        success: false,
        message: 'Amount due cannot be negative',
      });
    }

    // Validate payment method if provided
    if (payment_method) {
      const allowedMethods = ['Bank Transfer', 'Credit Card', 'Cash', 'Check', 'Other'];
      if (!allowedMethods.includes(payment_method)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid payment method',
        });
      }
    }

    // Prepare update object
    const updateData = {
      ...(supplier_id && { supplier: supplier_id }),
      ...(amountPaid && { amountPaid }),
      ...(amountDue !== undefined && { amountDue }),
      ...(payment_method && { paymentMethod: payment_method }),
      ...(date && { date }),
      ...(notes !== undefined && { notes }),
    };

    // Update payment
    const updatedPayment = await Payment.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    });

    res.status(200).json({
      success: true,
      message: 'Payment updated successfully',
      data: updatedPayment,
    });
  } catch (error) {
    console.error('Update Payment Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while updating payment',
      error: error.message,
    });
  }
};

// Delete a payment
exports.deletePayment = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if payment exists
    const payment = await Payment.findById(id);
    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found',
      });
    }

    // Remove payment from supplier's payment history
    await Supplier.findByIdAndUpdate(
      payment.supplier,
      { $pull: { paymentHistory: id } },
      { new: true }
    );

    // Delete payment
    await Payment.findByIdAndDelete(id);

    res.status(200).json({
      success: true,
      message: 'Payment deleted successfully',
    });
  } catch (error) {
    console.error('Delete Payment Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while deleting payment',
      error: error.message,
    });
  }
};

// List all payments with filters
exports.getAllPayments = async (req, res) => {
  try {
    const { supplier, startDate, endDate, paymentMethod, page = 1, limit = 10 } = req.query;

    // Build query
    const query = {};

    if (supplier) {
      query.supplier = supplier;
    }

    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }

    if (paymentMethod) {
      query.paymentMethod = paymentMethod;
    }

    // Pagination
    const skip = (page - 1) * limit;

    // Fetch payments
    const payments = await Payment.find(query)
      .populate('supplier', 'supplierName supplierCode')
      .sort({ date: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const totalPayments = await Payment.countDocuments(query);

    res.status(200).json({
      success: true,
      message: 'Payments fetched successfully',
      data: payments,
      total: totalPayments,
      currentPage: parseInt(page),
      totalPages: Math.ceil(totalPayments / limit),
      count: payments.length,
    });
  } catch (error) {
    console.error('Fetch Payments Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while fetching payments',
      error: error.message,
    });
  }
};