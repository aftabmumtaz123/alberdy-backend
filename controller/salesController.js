const Sale = require('../model/Sales');
const Variant = require('../model/variantProduct');
const User = require('../model/User');
const mongoose = require('mongoose');

exports.createSale = async (req, res) => {
  try {
    const { date, customerId, products, summary, payment, notes, status } = req.body;

    // Validate required fields
    if (!customerId || !products || !summary) {
      return res.status(400).json({ status: false, message: 'Customer ID, products, and summary are required' });
    }


    if(status === "Completed" && payment?.amountPaid < (summary.subTotal + (summary.otherCharges || 0) - (summary.discount || 0))){
      return res.status(400).json({ status: false, message: 'Amount paid is insufficient for a Completed sale' });
    }

    // Validate summary fields
    const { otherCharges = 0, discount = 0 } = summary;
    if (typeof otherCharges !== 'number' || otherCharges < 0) {
      return res.status(400).json({ status: false, message: 'otherCharges must be a non-negative number' });
    }
    if (typeof discount !== 'number' || discount < 0) {
      return res.status(400).json({ status: false, message: 'discount must be a non-negative number' });
    }

    // Validate customer
    const customer = await User.findById(customerId);
    if (!customer) return res.status(400).json({ status: false, message: 'Invalid customer' });

    // Validate products
    if (!Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ status: false, message: 'Products array is required and cannot be empty' });
    }

    let subTotal = 0;
    let totalQuantity = 0;
    let taxTotal = 0;
    const validatedProducts = [];
    for (let prod of products) {
      if (!prod.variantId || !prod.quantity || !prod.price || !prod.unitCost) {
        return res.status(400).json({ status: false, message: 'Each product must have variantId, quantity, price, and unitCost' });
      }
      if (prod.quantity < 1 || prod.price < 0 || prod.unitCost < 0 || (prod.taxPercent && prod.taxPercent < 0)) {
        return res.status(400).json({ status: false, message: 'Quantity, price, unitCost, and taxPercent must be valid' });
      }
      if (prod.taxType && !['Inclusive', 'Exclusive'].includes(prod.taxType)) {
        return res.status(400).json({ status: false, message: 'taxType must be Inclusive or Exclusive' });
      }
      const variant = await Variant.findById(prod.variantId);
      if (!variant || variant.status === 'Inactive') {
        return res.status(400).json({ status: false, message: `Invalid or inactive variant: ${prod.variantId}` });
      }
      if (variant.stockQuantity < prod.quantity) {
        return res.status(400).json({ status: false, message: `Insufficient stock for variant ${prod.variantId}` });
      }
      const taxAmount = (prod.price * prod.quantity * (prod.taxPercent || 0)) / 100 * (prod.taxType === 'Exclusive' ? 1 : 0);
      const productTotal = prod.price * prod.quantity + taxAmount;
      subTotal += productTotal;
      taxTotal += taxAmount;
      totalQuantity += prod.quantity;
      validatedProducts.push({ 
        variantId: prod.variantId, 
        quantity: prod.quantity, 
        price: prod.price, 
        taxPercent: prod.taxPercent || 0, 
        taxType: prod.taxType || 'Exclusive', 
        unitCost: prod.unitCost 
      });
    }

    // Validate summary calculations
    const grandTotal = subTotal + otherCharges - discount;
    if (grandTotal < 0) return res.status(400).json({ status: false, message: 'Grand total cannot be negative' });

    // Validate payment
    if (payment) {
      if (typeof payment.amountPaid !== 'number' || payment.amountPaid < 0) {
        return res.status(400).json({ status: false, message: 'payment.amountPaid must be a non-negative number' });
      }
      if (payment.type && !['Cash', 'Card', 'Online', 'BankTransfer'].includes(payment.type)) {
        return res.status(400).json({ status: false, message: 'Invalid payment type' });
      }
    }

    const amountPaid = payment?.amountPaid || 0;
    const amountDue = grandTotal - amountPaid;
    if (amountDue < 0) {
      return res.status(400).json({ status: false, message: 'Amount paid cannot exceed grand total' });
    }

    // Generate unique saleCode
    let saleCode = `SALE-000001`;
    let existing = await Sale.findOne().sort({ saleCode: -1 });
    if (existing) {
      let num = parseInt(existing.saleCode.split('-')[1]) + 1;
      saleCode = `SALE-${String(num).padStart(6, '0')}`;
    }
    while (await Sale.findOne({ saleCode })) {
      let num = parseInt(saleCode.split('-')[1]) + 1;
      saleCode = `SALE-${String(num).padStart(6, '0')}`;
    }


    let finalStatus = status;
    if(!finalStatus){
      finalStatus = amountPaid >= grandTotal ? 'Completed' : 'Pending';
    }

    // Create sale
    const sale = new Sale({
      saleCode,
      date: date && new Date(date) <= new Date() ? date : Date.now(),
      customerId,
      products: validatedProducts,
      status,
      payment: { 
        type: payment?.type || null, 
        amountPaid, 
        amountDue, 
        notes: payment?.notes || '' 
      },
      summary: { 
        totalQuantity, 
        subTotal, 
        taxTotal,
        discount, 
        otherCharges, 
        grandTotal 
      },
      notes: notes || '',
    });

    await sale.save();

    // Update inventory (skip if Cancelled)
    if (status !== 'Cancelled') {
      for (let prod of validatedProducts) {
        await Variant.findByIdAndUpdate(prod.variantId, { $inc: { stockQuantity: -prod.quantity } });
      }
    }

    // Populate response
    const populatedSale = await Sale.findById(sale._id)
      .populate('customerId', 'name email phone')
      .populate({
        path: 'products.variantId',
        select: 'sku attribute value unit purchasePrice price discountPrice stockQuantity expiryDate weightQuantity image',
        populate: [
          { path: 'product', select: 'name images thumbnail description' },
          { path: 'unit', select: 'name symbol' }
        ],
      });

    res.status(201).json({ 
      status: true, 
      message: 'Sale created successfully', 
      data: {
        _id: populatedSale._id,
        saleCode: populatedSale.saleCode,
        date: populatedSale.date,
        status: populatedSale.status,
        notes: populatedSale.notes,
        customer: {
          id: populatedSale.customerId?._id,
          name: populatedSale.customerId?.name || 'Walk-in Customer',
          email: populatedSale.customerId?.email || '',
          phone: populatedSale.customerId?.phone || '',
        },
        products: populatedSale.products.map((product) => {
          const variant = product.variantId;
          const taxAmount = (product.price * product.quantity * (product.taxPercent || 0)) / 100 
                          * (product.taxType === 'Exclusive' ? 1 : 0);
          return {
            variantId: variant?._id,
            productName: variant?.product?.name || 'Unknown',
            sku: variant?.sku || '',
            attribute: variant?.attribute || '',
            value: variant?.value || '',
            weightQuantity: variant?.weightQuantity || '',
            unit: variant?.unit?.name || 'Unknown',
            unitSymbol: variant?.unit?.symbol || '',
            image: variant?.product?.thumbnail || variant?.image || '',
            quantity: product.quantity,
            price: parseFloat(product.price.toFixed(2)),
            unitCost: parseFloat(product.unitCost.toFixed(2)),
            taxPercent: product.taxPercent || 0,
            taxType: product.taxType || 'Exclusive',
            taxAmount: parseFloat(taxAmount.toFixed(2)),
            total: parseFloat((product.price * product.quantity + taxAmount).toFixed(2)),
          };
        }),
        summary: {
          totalQuantity: populatedSale.summary.totalQuantity,
          subTotal: parseFloat(populatedSale.summary.subTotal.toFixed(2)),
          taxTotal: parseFloat(populatedSale.summary.taxTotal.toFixed(2)),
          discount: parseFloat(populatedSale.summary.discount.toFixed(2)),
          otherCharges: parseFloat(populatedSale.summary.otherCharges.toFixed(2)),
          grandTotal: parseFloat(populatedSale.summary.grandTotal.toFixed(2)),
        },
        payment: {
          type: populatedSale.payment.type || null,
          amountPaid: parseFloat(populatedSale.payment.amountPaid.toFixed(2)),
          amountDue: parseFloat(populatedSale.payment.amountDue.toFixed(2)),
          notes: populatedSale.payment.notes || '',
        },
        createdAt: populatedSale.createdAt,
        updatedAt: populatedSale.updatedAt,
      }
    });
  } catch (error) {
    console.error('Error creating sale:', error);
    res.status(500).json({ status: false, message: 'Server error', error: error.message });
  }
};

exports.getAllSales = async (req, res) => {
  try {
    const { page = 1, limit , startDate, endDate, paymentStatus, search } = req.query;
    const skip = (page - 1) * limit;

    let query = { isDeleted: false };
    if (startDate && endDate) {
      query.date = { $gte: new Date(startDate), $lte: new Date(endDate) };
    }
    if (paymentStatus) {
      query = {
        ...query,
        $expr: {
          [paymentStatus === 'Paid' ? '$gte' : '$lt']: [
            '$payment.amountPaid',
            '$summary.grandTotal',
          ],
        },
      };
    }
    if (search) {
      const user = await User.findOne({ name: { $regex: search, $options: 'i' } });
      query.$or = [{ saleCode: { $regex: search, $options: 'i' } }];
      if (user) {
        query.$or.push({ customerId: user._id });
      }
    }

    const sales = await Sale.find(query)
      .sort({ createdAt: -1 }) // Recent sales first
      .skip(skip)
      .limit(parseInt(limit))
      .populate('customerId', 'name email phone')
      .populate({
        path: 'products.variantId',
        select: 'sku attribute value unit purchasePrice price discountPrice stockQuantity expiryDate weightQuantity image',
        populate: [
          { path: 'product', select: 'name images thumbnail description' },
          { path: 'unit', select: 'name symbol' } // Consistent with create/update
        ],
      })
      .lean();

    const total = await Sale.countDocuments(query);

    res.status(200).json({
      status: true,
      message: 'Sales fetched successfully',
      data: sales.map((sale) => {
        const totalTax = sale.products.reduce((sum, p) => {
          const tax = (p.price * p.quantity * (p.taxPercent || 0)) / 100 * (p.taxType === 'Exclusive' ? 1 : 0);
          return sum + tax;
        }, 0);

        return {
          id: sale._id,
          saleCode: sale.saleCode,
          date: sale.date,
          status: sale.status,
          customer: {
            id: sale.customerId?._id,
            name: sale.customerId?.name || 'Walk-in Customer',
            email: sale.customerId?.email || '',
            phone: sale.customerId?.phone || '',
          },
          summary: {
            totalQuantity: sale.summary.totalQuantity,
            subTotal: parseFloat(sale.summary.subTotal.toFixed(2)),
            taxTotal: parseFloat((sale.summary.taxTotal || totalTax).toFixed(2)),
            discount: parseFloat(sale.summary.discount.toFixed(2)),
            otherCharges: parseFloat(sale.summary.otherCharges.toFixed(2)),
            grandTotal: parseFloat(sale.summary.grandTotal.toFixed(2)),
          },
          payment: {
            type: sale.payment.type || null,
            amountPaid: parseFloat(sale.payment.amountPaid.toFixed(2)),
            amountDue: parseFloat(sale.payment.amountDue.toFixed(2)),
            notes: sale.payment.notes || '',
          },
          paymentStatus: sale.payment.amountPaid >= sale.summary.grandTotal ? 'Paid' : 'Pending',
          products: sale.products.map((product) => {
            const taxAmount = (product.price * product.quantity * (product.taxPercent || 0)) / 100 
                            * (product.taxType === 'Exclusive' ? 1 : 0);
            return {
              variantId: product.variantId?._id,
              productName: product.variantId?.product?.name || 'Unknown',
              sku: product.variantId?.sku || '',
              attribute: product.variantId?.attribute || '',
              value: product.variantId?.value || '',
              weightQuantity: product.variantId?.weightQuantity || '',
              unit: product.variantId?.unit?.name || 'Unknown',
              image: product.variantId?.product?.thumbnail || product.variantId?.image || '',
              quantity: product.quantity,
              price: parseFloat(product.price.toFixed(2)),
              unitCost: parseFloat(product.unitCost.toFixed(2)),
              taxPercent: product.taxPercent || 0,
              taxType: product.taxType || 'Exclusive',
              taxAmount: parseFloat(taxAmount.toFixed(2)),
              total: parseFloat((product.price * product.quantity + taxAmount).toFixed(2)),
              productDescription: product.variantId?.product?.description || '',
            };
          }),
          createdAt: sale.createdAt,
          updatedAt: sale.updatedAt,
        };
      }),
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching sales:', error);
    res.status(500).json({ status: false, message: 'Server error', error: error.message });
  }
};

exports.deleteSale = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { id } = req.params;

    // Validate sale ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ status: false, message: 'Invalid sale ID' });
    }

    // Fetch sale
    const sale = await Sale.findById(id).session(session);
    if (!sale || sale.isDeleted) {
      return res.status(404).json({ status: false, message: 'Sale not found or already deleted' });
    }

    // Prevent deletion of completed or paid sales
    if (sale.status === 'Completed' || sale.payment.amountPaid >= sale.summary.grandTotal) {
      return res.status(400).json({ status: false, message: 'Cannot delete completed or fully paid sales' });
    }

    // Restore stock
    for (const product of sale.products) {
      if (product.variantId && mongoose.Types.ObjectId.isValid(product.variantId)) {
        const variant = await Variant.findById(product.variantId).session(session);
        if (!variant) {
          await session.abortTransaction();
          return res.status(400).json({ status: false, message: `Invalid variant: ${product.variantId}` });
        }
        await Variant.findByIdAndUpdate(
          product.variantId,
          { $inc: { stockQuantity: product.quantity } },
          { runValidators: true, session }
        );
        console.log(`Restored ${product.quantity} units to variant ${product.variantId} for sale ${sale.saleCode}`);
      }
    }

    // Soft delete sale
    sale.isDeleted = true;
    sale.salesHistory.push({
      action: 'Delete',
      changes: { isDeleted: true },
      date: new Date(),
    });
    await sale.save({ session });

    // Commit transaction
    await session.commitTransaction();
    res.status(200).json({ status: true, message: `Sale ${sale.saleCode} soft deleted successfully` });
  } catch (error) {
    await session.abortTransaction();
    console.error('Error deleting sale:', error);
    res.status(500).json({ status: false, message: 'Server error', error: error.message });
  } finally {
    session.endSession();
  }
};




exports.updateSale = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const { date, customerId, products, summary, payment, notes, status } = req.body;

    // Validate ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: 'Invalid sale ID' });
    }

    // Fetch sale
    const sale = await Sale.findById(id).session(session);
    if (!sale || sale.isDeleted) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: 'Sale not found or deleted' });
    }

    // Block editing of Completed or Cancelled sales (except for cancellation)
    if (sale.status === 'Completed') {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: 'Cannot modify a Completed sale' });
    }
    if (sale.status === 'Cancelled') {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: 'Cannot modify a Cancelled sale' });
    }

    // ==================================================================
    // 1. HANDLE CANCELLATION (Preserve data, just mark + restore stock)
    // ==================================================================
    if (status === 'Cancelled' && sale.status !== 'Cancelled') {
      // Restore stock for all previously sold items
      for (const item of sale.products) {
        if (item.variantId && mongoose.Types.ObjectId.isValid(item.variantId)) {
          await Variant.findByIdAndUpdate(
            item.variantId,
            { $inc: { stockQuantity: item.quantity } },
            { session }
          );
        }
      }

      // Only update status and zero out payment — keep everything else
      sale.status = 'Cancelled';
      sale.payment.amountPaid = 0;
      sale.payment.amountDue = 0;
      sale.notes = notes ? `${sale.notes || ''}\n[CANCELLED] ${notes}`.trim() : `${sale.notes || ''} [CANCELLED]`.trim();

      await sale.save({ session });
      await session.commitTransaction();

      return res.json({
        success: true,
        message: 'Sale cancelled successfully. Stock restored.',
        data: sale,
      });
    }

    // ==================================================================
    // 2. NORMAL UPDATE VALIDATION
    // ==================================================================
    if (!customerId || !products || !Array.isArray(products) || products.length === 0 || !summary) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: 'Customer, products, and summary are required' });
    }

    const { otherCharges = 0, discount = 0 } = summary;

    // Validate customer
    const customer = await User.findById(customerId).session(session);
    if (!customer) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: 'Invalid customer' });
    }

    let subtotal = 0;
    let taxTotal = 0;
    let totalQuantity = 0;
    const newProducts = [];

    // ==================================================================
    // 3. PROCESS NEW PRODUCTS + STOCK CHECK
    // ==================================================================
    for (const prod of products) {
      const { variantId, quantity, price, unitCost, taxPercent = 0, taxType = 'Exclusive' } = prod;

      if (!variantId || !quantity || !price || !unitCost) {
        await session.abortTransaction();
        return res.status(400).json({ success: false, message: 'variantId, quantity, price, unitCost required' });
      }

      if (quantity < 1 || price < 0 || unitCost < 0) {
        await session.abortTransaction();
        return res.status(400).json({ success: false, message: 'Invalid quantity or price' });
      }

      const variant = await Variant.findById(variantId).session(session);
      if (!variant || variant.status === 'Inactive') {
        await session.abortTransaction();
        return res.status(400).json({ success: false, message: `Invalid or inactive variant: ${variantId}` });
      }

      // Calculate available stock (old quantity is returned first)
      const oldItem = sale.products.find(p => p.variantId.toString() === variantId.toString());
      const oldQty = oldItem ? oldItem.quantity : 0;
      const availableStock = variant.stockQuantity + oldQty;

      if (availableStock < quantity) {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: `Insufficient stock for ${variant.sku || variantId}. Available: ${availableStock}, Requested: ${quantity}`,
        });
      }

      const taxAmount = taxType === 'Exclusive'
        ? (price * quantity * taxPercent) / 100
        : 0; // Inclusive tax handled at source

      const lineTotal = price * quantity + taxAmount;
      subtotal += lineTotal;
      taxTotal += taxAmount;
      totalQuantity += quantity;

      newProducts.push({
        variantId,
        quantity,
        price,
        unitCost,
        taxPercent,
        taxType,
        taxAmount,
        lineTotal,
      });
    }

    const grandTotal = subtotal + otherCharges - discount;
    if (grandTotal < 0) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: 'Grand total cannot be negative' });
    }

    // ==================================================================
    // 4. PAYMENT CALCULATION
    // ==================================================================
    const amountPaid = payment?.amountPaid !== undefined ? payment.amountPaid : sale.payment.amountPaid;
    const amountDue = grandTotal - amountPaid;

    if (amountDue < 0) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: 'Overpayment not allowed' });
    }

    // ==================================================================
    // 5. FINAL STATUS LOGIC (Secure & Auto-Correcting)
    // ==================================================================
    let finalStatus;

    if (status === 'Completed') {
      if (amountDue > 0) {
        await session.abortTransaction();
        return res.status(400).json({ success: false, message: 'Full payment required to mark as Completed' });
      }
      finalStatus = 'Completed';
    }
    else if (status === 'Pending' && amountPaid > 0) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: 'Cannot set Pending after receiving payment' });
    }
    else if (status === 'Partial' && amountDue === 0) {
      finalStatus = 'Completed'; // Auto-upgrade
    }
    else if (status && ['Pending', 'Partial'].includes(status)) {
      finalStatus = status;
    }
    else {
      // Auto-determine (best practice)
      finalStatus = amountDue === 0
        ? 'Completed'
        : amountPaid > 0
          ? 'Partial'
          : 'Pending';
    }

    // Prevent downgrading from Completed
    if (sale.status === 'Completed' && finalStatus !== 'Completed') {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: 'Cannot downgrade status from Completed' });
    }

    // ==================================================================
    // 6. RESTORE OLD STOCK (Always first)
    // ==================================================================
    for (const old of sale.products) {
      if (old.variantId && mongoose.Types.ObjectId.isValid(old.variantId)) {
        await Variant.findByIdAndUpdate(
          old.variantId,
          { $inc: { stockQuantity: old.quantity } },
          { session }
        );
      }
    }

    // ==================================================================
    // 7. DEDUCT NEW STOCK
    // ==================================================================
    for (const item of newProducts) {
      await Variant.findByIdAndUpdate(
        item.variantId,
        { $inc: { stockQuantity: -item.quantity } },
        { session }
      );
    }

    // ==================================================================
    // 8. SAVE SALE
    // ==================================================================
    sale.set({
      date: date ? new Date(date) : sale.date,
      customerId,
      products: newProducts.map(p => ({
        variantId: p.variantId,
        quantity: p.quantity,
        price: p.price,
        unitCost: p.unitCost,
        taxPercent: p.taxPercent,
        taxType: p.taxType,
        taxAmount: p.taxAmount,
        lineTotal: p.lineTotal,
      })),
      summary: {
        totalQuantity,
        subTotal: subtotal,
        taxTotal,
        discount: discount || 0,
        otherCharges: otherCharges || 0,
        grandTotal,
      },
      payment: {
        type: payment?.type || sale.payment.type,
        amountPaid,
        amountDue,
        notes: payment?.notes || sale.payment.notes,
      },
      notes: notes !== undefined ? notes : sale.notes,
      status: finalStatus,
    });

    await sale.save({ session });
    await session.commitTransaction();

    // ==================================================================
    // 9. POPULATED RESPONSE
    // ==================================================================
    const updatedSale = await Sale.findById(id)
      .populate('customerId', 'name email phone')
      .populate({
        path: 'products.variantId',
        populate: [
          { path: 'product', select: 'name thumbnail' },
          { path: 'unit', select: 'name symbol' },
        ],
      })
      .lean();

    return res.json({
      success: true,
      message: 'Sale updated successfully',
      data: {
        _id: updatedSale._id,
        saleCode: updatedSale.saleCode,
        date: updatedSale.date,
        status: updatedSale.status,
        customer: {
          id: updatedSale.customerId?._id,
          name: updatedSale.customerId?.name || 'Walk-in',
          email: updatedSale.customerId?.email || '',
          phone: updatedSale.customerId?.phone || '',
        },
        products: updatedSale.products.map(p => {
          const v = p.variantId;
          const taxAmt = p.taxType === 'Exclusive'
            ? (p.price * p.quantity * p.taxPercent) / 100
            : 0;
          return {
            variantId: v._id,
            productName: v.product?.name || 'Unknown',
            sku: v.sku || '',
            unit: v.unit?.name || '',
            quantity: p.quantity,
            price: Number(p.price.toFixed(2)),
            taxPercent: p.taxPercent,
            taxAmount: Number(taxAmt.toFixed(2)),
            total: Number((p.price * p.quantity + taxAmt).toFixed(2)),
          };
        }),
        summary: {
          totalQuantity: updatedSale.summary.totalQuantity,
          subTotal: Number(updatedSale.summary.subTotal.toFixed(2)),
          grandTotal: Number(updatedSale.summary.grandTotal.toFixed(2)),
          discount: Number((updatedSale.summary.discount || 0).toFixed(2)),
          otherCharges: Number((updatedSale.summary.otherCharges || 0).toFixed(2)),
        },
        payment: {
          type: updatedSale.payment.type,
          amountPaid: Number(updatedSale.payment.amountPaid.toFixed(2)),
          amountDue: Number(updatedSale.payment.amountDue.toFixed(2)),
        },
        notes: updatedSale.notes,
        createdAt: updatedSale.createdAt,
        updatedAt: updatedSale.updatedAt,
      },
    });

  } catch (error) {
    await session.abortTransaction();
    console.error('Update Sale Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};





exports.getSaleById = async (req, res) => {
  try {
    const { id } = req.params;
    const sale = await Sale.findById(id)
      .populate('customerId', 'name email phone')
      .populate({
        path: 'products.variantId',
        select: 'sku attribute value unit purchasePrice price discountPrice stockQuantity expiryDate weightQuantity image',
        populate: [
          { path: 'product', select: 'name images thumbnail description' },
          { path: 'unit', select: 'name symbol' }
        ],
      });
    if (!sale || sale.isDeleted) return res.status(404).json({ status: false, message: 'Sale not found' });

    res.status(200).json({ 
      status: true, 
      message: 'Sale fetched successfully',
      data: {
        _id: sale._id,
        saleCode: sale.saleCode,
        date: sale.date,
        status: sale.status,
        notes: sale.notes,
        customer: {
          id: sale.customerId?._id,
          name: sale.customerId?.name || 'Walk-in Customer',
          email: sale.customerId?.email || '',
          phone: sale.customerId?.phone || '',
        },
        products: sale.products.map((product) => {
          const variant = product.variantId;
          const taxAmount = (product.price * product.quantity * (product.taxPercent || 0)) / 100 
                          * (product.taxType === 'Exclusive' ? 1 : 0);
          return {
            variantId: variant?._id,
            productName: variant?.product?.name || 'Unknown',
            sku: variant?.sku || '',
            attribute: variant?.attribute || '',
            value: variant?.value || '',
            weightQuantity: variant?.weightQuantity || '',
            unit: variant?.unit?.name || 'Unknown',
            unitSymbol: variant?.unit?.symbol || '',
            image: variant?.product?.thumbnail || variant?.image || '',
            quantity: product.quantity,
            price: parseFloat(product.price.toFixed(2)),
            unitCost: parseFloat(product.unitCost.toFixed(2)),
            taxPercent: product.taxPercent || 0,
            taxType: product.taxType || 'Exclusive',
            taxAmount: parseFloat(taxAmount.toFixed(2)),
            total: parseFloat((product.price * product.quantity + taxAmount).toFixed(2)),
          };
        }),
        summary: {
          totalQuantity: sale.summary.totalQuantity,
          subTotal: parseFloat(sale.summary.subTotal.toFixed(2)),
          taxTotal: parseFloat(sale.summary.taxTotal.toFixed(2)),
          discount: parseFloat(sale.summary.discount.toFixed(2)),
          otherCharges: parseFloat(sale.summary.otherCharges.toFixed(2)),
          grandTotal: parseFloat(sale.summary.grandTotal.toFixed(2)),
        },
        payment: {
          type: sale.payment.type || null,
          amountPaid: parseFloat(sale.payment.amountPaid.toFixed(2)),
          amountDue: parseFloat(sale.payment.amountDue.toFixed(2)),
          notes: sale.payment.notes || '',
        },
        createdAt: sale.createdAt,
        updatedAt: sale.updatedAt,
      }
    });
  } catch (error) {
    console.error('Error fetching sale:', error);
    res.status(500).json({ status: false, message: 'Server error', error: error.message });
  }
};