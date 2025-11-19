const Payment = require('../model/Payment');
const Supplier = require('../model/Supplier');

// Generate unique invoice number
const generateInvoiceNo = async () => {
  let isUnique = false;
  let invoiceNo;
  while (!isUnique) {
    const randomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    invoiceNo = `INV-${randomCode}`;
    const existingPayment = await Payment.findOne({ invoiceNo });
    if (!existingPayment) {
      isUnique = true;
    }
  }
  return invoiceNo;
};

// Create a new payment
exports.createPayment = async (req, res) => {
  try {
    const { supplierId, amountPaid, amountDue, paymentMethod, date, notes, totalAmount, status } = req.body;

  

    if(!supplierId){
      return res.status(400).json({
        success: false,
        message: 'Supplier ID is required',
      });
    }

    if(!amountPaid){
      return res.status(400).json({
        success: false,
        message: 'Amount Paid is required',
      });
    }

    if(!paymentMethod){
      return res.status(400).json({
        success: false,
        message: 'Payment Method is required',
      });
    }

    if(!totalAmount){
      return res.status(400).json({
        success: false,
        message: 'Total Amount is required',
      });
    }

    // Check if supplier exists
    const supplier = await Supplier.findById(supplierId);
    if (!supplier) {
      return res.status(404).json({
        success: false,
        message: 'Supplier not found',
      });
    }

    // Validate totalAmount
    if (totalAmount < 0) {
      return res.status(400).json({
        success: false,
        message: 'Total amount cannot be negative',
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

    // // Validate consistency: totalAmount = amountPaid + amountDue
    // const calculatedTotal = amountPaid + (amountDue || 0);
    // if (totalAmount !== calculatedTotal) {
    //   return res.status(400).json({
    //     success: false,
    //     message: 'Total amount must equal amount paid plus amount due',
    //   });
    // }

    // Validate payment method
    const allowedMethods = ['Bank Transfer', 'Credit Card', 'Cash', 'Check', 'Other'];
    if (!allowedMethods.includes(paymentMethod)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payment method',
      });
    }

    // Validate status (if provided)
    const allowedStatuses = ['Pending', 'Completed', 'Partial', 'Cancelled'];
    let paymentStatus = status || (amountDue > 0 ? 'Partial' : 'Completed');
    if (!allowedStatuses.includes(paymentStatus)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payment status',
      });
    }

    // Generate unique invoice number
    const invoiceNo = await generateInvoiceNo();

    // Create payment
    const payment = new Payment({
      supplier: supplierId,
      totalAmount,
      amountPaid,
      amountDue,
      paymentMethod: paymentMethod,
      invoiceNo,
      date: date || Date.now(),
      notes,
      status: paymentStatus,
    });

    await payment.save();

    // Update supplier's payment history
    await Supplier.findByIdAndUpdate(
      supplierId,
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
    const { supplierId, amountPaid, amountDue, paymentMethod, invoice_no, date, notes, totalAmount, status } = req.body;

    // Check if payment exists
    const payment = await Payment.findById(id);
    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found',
      });
    }

     if(payment.status === "Completed"){
      return res.status(400).json({
        success: false,
        msg: 'Cannot edit completed payments',
      }) 
    }

    // Validate supplier if provided
    if (supplierId) {
      const supplier = await Supplier.findById(supplierId);
      if (!supplier) {
        return res.status(404).json({
          success: false,
          message: 'Supplier not found',
        });
      }
    }

    // Validate totalAmount if provided
    if (totalAmount !== undefined && totalAmount < 0) {
      return res.status(400).json({
        success: false,
        message: 'Total amount cannot be negative',
      });
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

    // Validate consistency: totalAmount = amountPaid + amountDue
    if (totalAmount !== undefined || amountPaid !== undefined || amountDue !== undefined) {
      const updatedTotal = totalAmount !== undefined ? totalAmount : payment.totalAmount;
      const updatedPaid = amountPaid !== undefined ? amountPaid : payment.amountPaid;
      const updatedDue = amountDue !== undefined ? amountDue : payment.amountDue || 0;
    //   if (updatedTotal !== updatedPaid + updatedDue) {
    //     return res.status(400).json({
    //       success: false,
    //       message: 'Total amount must equal amount paid plus amount due',
    //     });
    //   }
    }

    // Validate payment method if provided
    if (paymentMethod) {
      const allowedMethods = ['Bank Transfer', 'Credit Card', 'Cash', 'Check', 'Other'];
      if (!allowedMethods.includes(paymentMethod)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid payment method',
        });
      }
    }

    // Validate invoiceNo if provided
    if (invoice_no) {
      if (invoice_no.trim() === '') {
        return res.status(400).json({
          success: false,
          message: 'Invoice number cannot be empty',
        });
      }
      // Check for uniqueness if invoiceNo is being updated
      const existingPayment = await Payment.findOne({ invoiceNo: invoice_no, _id: { $ne: id } });
      if (existingPayment) {
        return res.status(400).json({
          success: false,
          message: 'Invoice number already exists',
        });
      }
    }

    // Validate status if provided
    if (status) {
      const allowedStatuses = ['Pending', 'Completed', 'Partial', 'Cancelled'];
      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid payment status',
        });
      }
    }

    // Prepare update object
    const updateData = {
      ...(supplierId && { supplier: supplierId }),
      ...(totalAmount !== undefined && { totalAmount }),
      ...(amountPaid && { amountPaid }),
      ...(amountDue !== undefined && { amountDue }),
      ...(paymentMethod && { paymentMethod: paymentMethod }),
      ...(invoice_no && { invoiceNo: invoice_no }),
      ...(date && { date }),
      ...(notes !== undefined && { notes }),
      ...(status && { status }),
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

    // Optional: Restrict deletion of certain statuses
    if (payment.status === 'Completed') {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete completed payments',
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
    const { supplier, startDate, endDate, paymentMethod, reference, status, page = 1, limit } = req.query;

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

    if (reference) {
      query.invoiceNo = { $regex: reference, $options: 'i' };
    }

    if (status) {
      query.status = status;
    }

    // Pagination
    const skip = (page - 1) * limit;

    // Fetch payments
    const payments = await Payment.find(query)
      .populate('supplier', 'supplierName supplierCode email phone address')
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