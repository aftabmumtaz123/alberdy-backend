const CustomerPayment = require('../model/CustomerPayment');
const User = require('../model/User');

// Generate unique invoice number
const generateInvoiceNo = async () => {
  let isUnique = false;
  let invoiceNo;
  while (!isUnique) {
    const randomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    invoiceNo = `INV-${randomCode}`;
    const existingPayment = await CustomerPayment.findOne({ invoiceNo });
    if (!existingPayment) {
      isUnique = true;
    }
  }
  return invoiceNo;
};

// Create a new customer payment
exports.createPayment = async (req, res) => {
  try {
    const { customerId, amountPaid, amountDue, payment_method, date, notes, totalAmount, status } = req.body;

    // Validate input
    if (!customerId || !amountPaid || !payment_method || totalAmount === undefined) {
      return res.status(400).json({
        success: false,
        msg: 'Customer ID, amount paid, payment method, and total amount are required',
      });
    }


    if(!customerId){
       return res.status(400).json({
        success: false,
        msg: 'Customer ID is required',
      });
    }



    // Check if customer exists and is a Customer
    const customer = await User.findById(customerId);
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

    // Validate totalAmount
    if (totalAmount < 0) {
      return res.status(400).json({
        success: false,
        msg: 'Total amount cannot be negative',
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

    // Validate consistency: totalAmount = amountPaid + amountDue
    const calculatedTotal = amountPaid + (amountDue || 0);
    // if (totalAmount !== calculatedTotal) {
    //   return res.status(400).json({
    //     success: false,
    //     msg: 'Total amount must equal amount paid plus amount due',
    //   });
    // }

    // Validate payment method
    const allowedMethods = ['Bank Transfer', 'Credit Card', 'Cash', 'Check', 'Other'];
    if (!allowedMethods.includes(payment_method)) {
      return res.status(400).json({
        success: false,
        msg: 'Invalid payment method',
      });
    }

    // Validate status (if provided)
    const allowedStatuses = ['Pending', 'Completed', 'Partial', 'Cancelled'];
    let paymentStatus = status || (amountDue > 0 ? 'Partial' : 'Completed');
    if (!allowedStatuses.includes(paymentStatus)) {
      return res.status(400).json({
        success: false,
        msg: 'Invalid payment status',
      });
    }

    // Generate unique invoice number
    const invoiceNo = await generateInvoiceNo();

    // Create payment
    const payment = new CustomerPayment({
      customer: customerId,
      totalAmount,
      amountPaid,
      amountDue,
      paymentMethod: payment_method,
      invoiceNo,
      date: date || Date.now(),
      notes,
      status: paymentStatus,
    });

    await payment.save();

    // Update customer's payment history
    await User.findByIdAndUpdate(
      customerId,
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
    const { customerId, amountPaid, amountDue, payment_method, invoice_no, date, notes, totalAmount, status } = req.body;

    // Check if payment exists
    const payment = await CustomerPayment.findById(id);
    if (!payment) {
      return res.status(404).json({
        success: false,
        msg: 'Payment not found',
      });
    }

    // Validate customer if provided
    if (customerId) {
      const customer = await User.findById(customerId);
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

    // Validate totalAmount if provided
    if (totalAmount !== undefined && totalAmount < 0) {
      return res.status(400).json({
        success: false,
        msg: 'Total amount cannot be negative',
      });
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

    // Validate consistency: totalAmount = amountPaid + amountDue
    if (totalAmount !== undefined || amountPaid !== undefined || amountDue !== undefined) {
      const updatedTotal = totalAmount !== undefined ? totalAmount : payment.totalAmount;
      const updatedPaid = amountPaid !== undefined ? amountPaid : payment.amountPaid;
      const updatedDue = amountDue !== undefined ? amountDue : payment.amountDue || 0;
      // if (updatedTotal !== updatedPaid + updatedDue) {
      //   return res.status(400).json({
      //     success: false,
      //     msg: 'Total amount must equal amount paid plus amount due',
      //   });
      // }
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

    // Validate invoiceNo if provided
    if (invoice_no) {
      if (invoice_no.trim() === '') {
        return res.status(400).json({
          success: false,
          msg: 'Invoice number cannot be empty',
        });
      }
      // Check for uniqueness if invoiceNo is being updated
      const existingPayment = await CustomerPayment.findOne({ invoiceNo: invoice_no, _id: { $ne: id } });
      if (existingPayment) {
        return res.status(400).json({
          success: false,
          msg: 'Invoice number already exists',
        });
      }
    }

    // Validate status if provided
    if (status) {
      const allowedStatuses = ['Pending', 'Completed', 'Partial', 'Cancelled'];
      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          msg: 'Invalid payment status',
        });
      }
    }

    // Prepare update object
    const updateData = {
      ...(customerId && { customer: customerId }),
      ...(totalAmount !== undefined && { totalAmount }),
      ...(amountPaid && { amountPaid }),
      ...(amountDue !== undefined && { amountDue }),
      ...(payment_method && { paymentMethod: payment_method }),
      ...(invoice_no && { invoiceNo: invoice_no }),
      ...(date && { date }),
      ...(notes !== undefined && { notes }),
      ...(status && { status }),
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

    // Optional: Restrict deletion of certain statuses
    // if (payment.status === 'Completed') {
    //   return res.status(400).json({
    //     success: false,
    //     msg: 'Cannot delete completed payments',
    //   });
    // }

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
    const { customer, startDate, endDate, paymentMethod, reference, status, page = 1, limit = 10 } = req.query;

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

    if (status) {
      query.status = status;
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
