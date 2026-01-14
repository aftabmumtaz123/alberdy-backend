const CustomerPayment = require('../model/CustomerPayment');
const User = require('../model/User');
const { createNotification } = require('../utils/createNotification');
const sendTemplatedEmail = require('../utils/sendTemplatedEmail');
const AppConfiguration = require('../model/app_configuration');



const getCurrencySettings = async () => {
  try {
    const config = await AppConfiguration.findOne()
      .lean()
      .select('currencySign');

    return {
      currencySign: config?.currencySign || '$',
    };
  } catch (err) {
    return { currencySign: '$' };
  }
};



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



    if (!customerId) {
      return res.status(400).json({
        success: false,
        msg: 'Customer ID is required',
      });
    }


    if (amountPaid === undefined || amountPaid === null) {
      return res.status(400).json({
        success: false,
        message: 'Amount Paid is required',
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
      payment_method: payment_method,
      invoiceNo,
      date: date || Date.now(),
      notes,
      status: paymentStatus,
    });

    await payment.save();


    // ===============================
// 🔔 NOTIFICATION + EMAIL TO CUSTOMER
// ===============================
try {
  const currency = await getCurrencySettings();
  const sign = currency.currencySign || '$';

  const totalFormatted = `${sign}${Number(totalAmount).toFixed(2)}`;
  const paidFormatted = `${sign}${Number(amountPaid).toFixed(2)}`;
  const dueFormatted = `${sign}${Number(amountDue || 0).toFixed(2)}`;

  // 🔔 Create Notification
  await createNotification({
    userId: customerId,
    type: 'customer_payment_created',
    title: 'Payment Received',
    message: `Invoice ${invoiceNo} • Paid ${paidFormatted} • ${paymentStatus}`,
    related: {
      paymentId: payment._id.toString()
    }
  });

  // 📧 Send Email
  if (customer.email) {
    const vars = {
      invoiceNo,
      customerName: customer.name,
      totalAmount: totalFormatted,
      amountPaid: paidFormatted,
      amountDue: dueFormatted,
      status: paymentStatus
    };

    await sendTemplatedEmail(
      customer.email,
      'customer_payment_created_customer',
      vars
    );
  }

} catch (notifyErr) {
  console.error('Customer payment notify/email error:', notifyErr);
}


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

// ──────────────────────────────────────────────────────────────
// UPDATE PAYMENT - FULLY FIXED (Status & amountDue always recalculated)
// ──────────────────────────────────────────────────────────────
exports.updatePayment = async (req, res) => {
  try {
    const { id } = req.params;
    const { customerId, amountPaid, payment_method, invoice_no, date, notes, totalAmount } = req.body;
    // Note: 'status' and 'amountDue' are NOT accepted from body

    const payment = await CustomerPayment.findById(id);
    if (!payment) {
      return res.status(404).json({ success: false, msg: 'Payment not found' });
    }

    if (payment.status === 'Completed') {
      return res.status(400).json({ success: false, msg: 'Cannot edit completed payments' });
    }

    // === Determine new values (fallback to existing) ===
    const newTotalAmount = totalAmount !== undefined ? Number(totalAmount) : payment.totalAmount;
    const newAmountPaid = amountPaid !== undefined ? Number(amountPaid) : payment.amountPaid;

    // Validations
    if (newTotalAmount < 0) {
      return res.status(400).json({ success: false, msg: 'Total amount cannot be negative' });
    }
    if (newAmountPaid < 0) {
      return res.status(400).json({ success: false, msg: 'Amount paid cannot be negative' });
    }

    // === Always recalculate amountDue and status ===
    const newAmountDue = newTotalAmount - newAmountPaid;
    const newStatus = newAmountPaid >= newTotalAmount && newTotalAmount > 0 ? 'Completed'
      : newAmountPaid > 0 ? 'Partial'
        : 'Pending';

    // Optional: Validate customer if changing
    if (customerId) {
      const customer = await User.findById(customerId);
      if (!customer || customer.role !== 'Customer') {
        return res.status(400).json({ success: false, msg: 'Valid customer not found' });
      }
    }

    // Validate payment method
    if (payment_method && !['Bank Transfer', 'Credit Card', 'Cash', 'Check', 'Other'].includes(payment_method)) {
      return res.status(400).json({ success: false, msg: 'Invalid payment method' });
    }

    // Validate invoice_no uniqueness
    if (invoice_no) {
      const exists = await CustomerPayment.findOne({ invoiceNo: invoice_no, _id: { $ne: id } });
      if (exists) {
        return res.status(400).json({ success: false, msg: 'Invoice number already exists' });
      }
    }

    // === Build update object ===
    const updateData = {
      ...(customerId && { customer: customerId }),
      totalAmount: newTotalAmount,
      amountPaid: newAmountPaid,
      amountDue: newAmountDue,
      status: newStatus, // Always auto-calculated
      ...(payment_method && { payment_method }),
      ...(invoice_no && { invoiceNo: invoice_no }),
      ...(date && { date }),
      ...(notes !== undefined && { notes }),
    };

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
    res.status(500).json({ success: false, msg: 'Server error' });
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
    if (payment.status === 'Completed') {
      return res.status(400).json({
        success: false,
        msg: 'Cannot delete completed payments',
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
    const { customer, startDate, endDate, payment_method, reference, status, page = 1, limit } = req.query;

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

    if (payment_method) {
      query.payment_method = payment_method;
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
      .sort({ createdAt: -1 })
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
