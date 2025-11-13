const CustomerPayment = require('../model/CustomerPayment');
const User = require('../model/User');

// Create a new customer payment
exports.createPayment = async (req, res) => {
  try {
    const { customer_id, amountPaid, amountDue, payment_method, invoice_no, date, notes } = req.body;

    // Validate input
    if (!customer_id || !amountPaid || !payment_method || !invoice_no) {
      return res.status(400).json({
        success: false,
        msg: 'Customer ID, amount paid, payment method, and invoice number are required',
      });
    }

    // Check if customer exists and is a Customer
    const customer = await User.findById(customer_id);
    if (!customer) {
      return res.status(404).json({
        success: false,
        msg: 'Customer not found',
      });
    }
    if (customer.role !== 'Customer') {
      return res.status(400).json({
        success: false,
        msg: 'User is not a customer',
      });
    }

    // Validate amountPaid
    if (amountPaid <= 0) {
      return res.status(400).json({
        success: false,
        msg: 'Amount paid must be greater than zero',
      });
    }

    // Validate amountDue (if provided)
    if (amountDue !== undefined && amountDue < 0) {
      return res.status(400).json({
        success: false,
        msg: 'Amount due cannot be negative',
      });
    }

    // Validate payment method
    const allowedMethods = ['Bank Transfer', 'Credit Card', 'Cash', 'Check', 'Other'];
    if (!allowedMethods.includes(payment_method)) {
      return res.status(400).json({
        success: false,
        msg: 'Invalid payment method',
      });
    }

    // Create payment
    const payment = new CustomerPayment({
      customer: customer_id,
      amountPaid,
      amountDue,
      paymentMethod: payment_method,
      invoiceNo: invoice_no,
      date: date || Date.now(),
      notes,
    });

    await payment.save();

    // Update customer's payment history
    await User.findByIdAndUpdate(
      customer_id,
      { $push: { paymentHistory: payment._id } },
      { new: true }
    );

    res.status(201).json({
      success: true,
      msg: 'Payment created successfully',
      data: payment,
    });
  } catch (err) {
    console.error('Create Payment Error:', err);
    res.status(500).json({
      success: false,
      msg: 'Server error occurred while creating payment',
    });
  }
};

// Edit a customer payment
exports.updatePayment = async (req, res) => {
  try {
    const { id } = req.params;
    const { customer_id, amountPaid, amountDue, payment_method, invoice_no, date, notes } = req.body;

    // Check if payment exists
    const payment = await CustomerPayment.findById(id);
    if (!payment) {
      return res.status(404).json({
        success: false,
        msg: 'Payment not found',
      });
    }

    // Validate customer if provided
    if (customer_id) {
      const customer = await User.findById(customer_id);
      if (!customer) {
        return res.status(404).json({
          success: false,
          msg: 'Customer not found',
        });
      }
      if (customer.role !== 'Customer') {
        return res.status(400).json({
          success: false,
          msg: 'User is not a customer',
        });
      }
    }

    // Validate amountPaid if provided
    if (amountPaid && amountPaid <= 0) {
      return res.status(400).json({
        success: false,
        msg: 'Amount paid must be greater than zero',
      });
    }

    // Validate amountDue if provided
    if (amountDue !== undefined && amountDue < 0) {
      return res.status(400).json({
        success: false,
        msg: 'Amount due cannot be negative',
      });
    }

    // Validate payment method if provided
    if (payment_method) {
      const allowedMethods = ['Bank Transfer', 'Credit Card', 'Cash', 'Check', 'Other'];
      if (!allowedMethods.includes(payment_method)) {
        return res.status(400).json({
          success: false,
          msg: 'Invalid payment method',
        });
      }
    }

    // Prepare update object
    const updateData = {
      ...(customer_id && { customer: customer_id }),
      ...(amountPaid && { amountPaid }),
      ...(amountDue !== undefined && { amountDue }),
      ...(payment_method && { paymentMethod: payment_method }),
      ...(invoice_no && { invoiceNo: invoice_no }),
      ...(date && { date }),
      ...(notes !== undefined && { notes }),
    };

    // Update payment
    const updatedPayment = await CustomerPayment.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    });

    res.status(200).json({
      success: true,
      msg: 'Payment updated successfully',
      data: updatedPayment,
    });
  } catch (err) {
    console.error('Update Payment Error:', err);
    res.status(500).json({
      success: false,
      msg: 'Server error occurred while updating payment',
    });
  }
};

// Delete a customer payment
exports.deletePayment = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if payment exists
    const payment = await CustomerPayment.findById(id);
    if (!payment) {
      return res.status(404).json({
        success: false,
        msg: 'Payment not found',
      });
    }

    // Remove payment from customer's payment history
    await User.findByIdAndUpdate(
      payment.customer,
      { $pull: { paymentHistory: id } },
      { new: true }
    );

    // Delete payment
    await CustomerPayment.findByIdAndDelete(id);

    res.status(200).json({
      success: true,
      msg: 'Payment deleted successfully',
    });
  } catch (err) {
    console.error('Delete Payment Error:', err);
    res.status(500).json({
      success: false,
      msg: 'Server error occurred while deleting payment',
    });
  }
};

// List all customer payments with filters
exports.getAllPayments = async (req, res) => {
  try {
    const { customer, startDate, endDate, paymentMethod, reference, page = 1, limit} = req.query;

    // Build query
    const query = {};

    if (customer) {
      query.customer = customer;
    }

    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }

    if (paymentMethod) {
      query.paymentMethod = paymentMethod;
    }

    if (reference) {
      query.invoiceNo = { $regex: reference, $options: 'i' };
    }

    // Pagination
    const skip = (page - 1) * limit;

    // Fetch payments
    const payments = await CustomerPayment.find(query)
      .populate('customer', 'name email')
      .sort({ date: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const totalPayments = await CustomerPayment.countDocuments(query);

    res.status(200).json({
      success: true,
      msg: 'Payments fetched successfully',
      data: payments,
      pagination: {
        total: totalPayments,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(totalPayments / limit),
        hasNextPage: parseInt(page) * parseInt(limit) < totalPayments,
        hasPrevPage: parseInt(page) > 1,
      },
    });
  } catch (err) {
    console.error('Fetch Payments Error:', err);
    res.status(500).json({
      success: false,
      msg: 'Server error occurred while fetching payments',
    });
  }
};