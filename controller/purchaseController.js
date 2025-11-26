const Purchase = require('../model/Purchase');
const Variant = require('../model/variantProduct');
const Supplier = require('../model/Supplier');
const mongoose = require('mongoose');




exports.createPurchase = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { supplierId, products, summary, payment, notes, status } = req.body;

    // === 1. BASIC VALIDATION ===
    if (!supplierId || !products || !Array.isArray(products) || products.length === 0) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: 'Supplier and products are required' });
    }

    if (!summary || typeof summary !== 'object') {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: 'Summary is required' });
    }

    const { otherCharges = 0, discount = 0 } = summary;
    if (otherCharges < 0 || discount < 0) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: 'Charges and discount cannot be negative' });
    }

    // === 2. VALIDATE SUPPLIER ===
    const supplier = await Supplier.findById(supplierId).session(session);
    if (!supplier) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: 'Invalid supplier' });
    }

    // === 3. PROCESS PRODUCTS ===
    let subtotal = 0;
    const validatedProducts = [];

    for (const item of products) {
      const { variantId, quantity, unitPrice, taxPercent = 0 } = item;

      if (!variantId || !quantity || unitPrice === undefined) {
        await session.abortTransaction();
        return res.status(400).json({ success: false, message: 'variantId, quantity, and unitPrice are required' });
      }

      if (quantity < 1 || unitPrice < 0 || taxPercent < 0) {
        await session.abortTransaction();
        return res.status(400).json({ success: false, message: 'Invalid quantity, price, or tax' });
      }

      const variant = await Variant.findById(variantId).session(session);
      if (!variant || variant.status === 'Inactive') {
        await session.abortTransaction();
        return res.status(400).json({ success: false, message: `Variant not found or inactive: ${variantId}` });
      }

      const taxAmount = (unitPrice * quantity * taxPercent) / 100;
      const lineTotal = unitPrice * quantity + taxAmount;
      subtotal += lineTotal;

      validatedProducts.push({
        variantId,
        quantity,
        unitPrice,
        taxPercent,
        taxAmount,
        lineTotal,
      });
    }

    const grandTotal = subtotal + otherCharges - discount;
    if (grandTotal < 0) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: 'Grand total cannot be negative' });
    }

    // === 4. PAYMENT ===
    const amountPaid = payment?.amountPaid >= 0 ? payment.amountPaid : 0;
    const amountDue = grandTotal - amountPaid;

    if (amountDue < 0) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: 'Overpayment not allowed' });
    }

    // === 5. FINAL STATUS LOGIC — SAME AS SALE & UPDATE ===
    let finalStatus;

    if (status === 'Completed') {
      if (amountDue > 0) {
        await session.abortTransaction();
        return res.status(400).json({ success: false, message: 'Full payment required to create as Completed' });
      }
      finalStatus = 'Completed';
    }
    else if (status === 'Pending' && amountPaid > 0) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: 'Cannot create as Pending when payment is received' });
    }
    else if (status === 'Partial' && amountDue === 0) {
      finalStatus = 'Completed'; // Auto-upgrade
    }
    else if (status && ['Pending', 'Partial'].includes(status)) {
      finalStatus = status;
    }
    else {
      // AUTO-DETERMINE — Best practice
      finalStatus = amountDue === 0
        ? 'Completed'
        : amountPaid > 0
          ? 'Partial'
          : 'Pending';
    }

    // === 6. GENERATE PURCHASE CODE (Sequential & Clean) ===
    const lastPurchase = await Purchase.findOne()
      .sort({ createdAt: -1 })
      .select('purchaseCode')
      .session(session);

    let seq = 1;
    if (lastPurchase && lastPurchase.purchaseCode) {
      const match = lastPurchase.purchaseCode.match(/PUR-(\d+)$/);
      if (match) seq = parseInt(match[1]) + 1;
    }
    const purchaseCode = `PUR-${String(seq).padStart(6, '0')}`;

    // === 7. CREATE PURCHASE DOCUMENT ===
    const purchase = new Purchase({
      purchaseCode,
      supplierId,
      products: validatedProducts.map(p => ({
        variantId: p.variantId,
        quantity: p.quantity,
        unitPrice: p.unitPrice,
        taxPercent: p.taxPercent,
        taxAmount: p.taxAmount,
        lineTotal: p.lineTotal,
      })),
      summary: {
        subtotal,
        otherCharges,
        discount,
        grandTotal,
      },
      payment: {
        type: payment?.type || 'Cash',
        amountPaid,
        amountDue,
      },
      notes: notes || '',
      status: finalStatus,
    });

    await purchase.save({ session });

    // === 8. UPDATE STOCK & PURCHASE PRICE ===
    for (const item of validatedProducts) {
      const update = {
        $inc: { stockQuantity: item.quantity },
      };

      // Update purchasePrice only if changed
      const variant = await Variant.findById(item.variantId).session(session);
      if (variant.purchasePrice !== item.unitPrice) {
        update.$set = { purchasePrice: item.unitPrice };
      }

      await Variant.findByIdAndUpdate(item.variantId, update, { session });
    }

    await session.commitTransaction();

    // === 9. RETURN POPULATED RESPONSE ===
    const populatedPurchase = await Purchase.findById(purchase._id)
      .populate('supplierId', 'supplierName contact phone')
      .populate({
        path: 'products.variantId',
        populate: [
          { path: 'product', select: 'name' },
          { path: 'unit', select: 'short_name' },
        ],
      })
      .lean();

    return res.status(201).json({
      success: true,
      message: 'Purchase created successfully',
      data: {
        _id: populatedPurchase._id,
        purchaseCode: populatedPurchase.purchaseCode,
        date: populatedPurchase.createdAt,
        status: populatedPurchase.status,
        supplier: {
          id: populatedPurchase.supplierId?._id,
          name: populatedPurchase.supplierId?.supplierName || 'Unknown',
        },
        products: populatedPurchase.products.map(p => {
          const v = p.variantId;
          return {
            variantId: v._id,
            productName: v.product?.name || 'Unknown',
            quantity: p.quantity,
            unitPrice: Number(p.unitPrice.toFixed(2)),
            taxAmount: Number(p.taxAmount.toFixed(2)),
            total: Number(p.lineTotal.toFixed(2)),
          };
        }),
        summary: {
          subtotal: Number(populatedPurchase.summary.subtotal.toFixed(2)),
          grandTotal: Number(populatedPurchase.summary.grandTotal.toFixed(2)),
        },
        payment: {
          amountPaid: Number(populatedPurchase.payment.amountPaid.toFixed(2)),
          amountDue: Number(populatedPurchase.payment.amountDue.toFixed(2)),
        },
        notes: populatedPurchase.notes,
        createdAt: populatedPurchase.createdAt,
      },
    });

  } catch (error) {
    await session.abortTransaction();
    console.error('Create Purchase Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};




exports.getAllPurchases = async (req, res) => {
  try {
    const { page = 1, limit } = req.query;
    const skip = (page - 1) * limit;

    const purchases = await Purchase.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('supplierId', 'supplierName')
      .populate({
        path: 'products.variantId',
        select: 'sku attribute value unit purchasePrice price discountPrice stockQuantity expiryDate weightQuantity image',
        populate: [
          {
            path: 'product',
            select: 'name images thumbnail description',
          },
          {
            path: 'unit',
            select: 'short_name',
          },
        ],
      });

    const total = await Purchase.countDocuments();

    res.status(200).json({
      success: true,
      message: 'Purchases fetched successfully',
      data: purchases,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching purchases:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching purchases',
      error: error.message,
    });
  }
};

exports.getPurchaseById = async (req, res) => {
  try {
    const { id } = req.params;
    const purchase = await Purchase.findById(id)
      .populate('supplierId', 'supplierName')
      .populate({
        path: 'products.variantId',
        select: 'sku attribute value unit purchasePrice price discountPrice stockQuantity expiryDate weightQuantity image',
        populate: [
          {
            path: 'product',
            select: 'name images thumbnail description',
          },
          {
            path: 'unit',
            select: 'short_name',
          },
        ],
      });

    if (!purchase)
      return res.status(404).json({ success: false, message: 'Purchase not found' });

    res.status(200).json({
      success: true,
      message: 'Purchase fetched successfully',
      data: purchase,
    });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching purchase',
      error: error.message,
    });
  }
};


exports.updatePurchase = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const { supplierId, products, summary, payment, notes, status } = req.body;

    // Validate ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: 'Invalid purchase ID' });
    }

    // Fetch purchase
    const purchase = await Purchase.findById(id).session(session);
    if (!purchase || purchase.isDeleted) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: 'Purchase not found or deleted' });
    }

    // Block editing of Completed or Cancelled purchases (except cancellation flow)
    if (purchase.status === 'Completed') {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: 'Cannot modify a Completed purchase' });
    }
    if (purchase.status === 'Cancelled') {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: 'Cannot modify a Cancelled purchase' });
    }

    // ==================================================================
    // 1. HANDLE CANCELLATION — KEEP ALL DATA, JUST MARK + RESTORE STOCK
    // ==================================================================
    if (status === 'Cancelled' && purchase.status !== 'Cancelled') {
      // Restore stock for all purchased items
      for (const item of purchase.products) {
        await Variant.findByIdAndUpdate(
          item.variantId,
          { $inc: { stockQuantity: -item.quantity } }, // return stock
          { session }
        );
      }

      // Keep everything: products, prices, summary — only update status & payment
      purchase.status = 'Cancelled';
      purchase.payment.amountPaid = 0;
      purchase.payment.amountDue = 0;

      // Optional: append cancellation note
      const cancelNote = notes ? `[CANCELLED] ${notes}` : '[CANCELLED]';
      purchase.notes = purchase.notes ? `${purchase.notes}\n${cancelNote}`.trim() : cancelNote;

      await purchase.save({ session });
      await session.commitTransaction();

      return res.json({
        success: true,
        message: 'Purchase cancelled successfully. Stock restored.',
        data: purchase,
      });
    }

    // ==================================================================
    // 2. NORMAL UPDATE (Pending / Partial → Edit)
    // ==================================================================
    if (!supplierId && !purchase.supplierId) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: 'Supplier is required' });
    }

    if (!products || !Array.isArray(products) || products.length === 0 || !summary) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: 'Products and summary are required' });
    }

    const { otherCharges = 0, discount = 0 } = summary;

    let subtotal = 0;
    const newProductItems = [];

    // ==================================================================
    // 3. PROCESS PRODUCTS + VALIDATE STOCK
    // ==================================================================
    for (const item of products) {
      const { variantId, quantity, unitPrice, taxPercent = 0 } = item;

      if (!variantId || !quantity || unitPrice === undefined) {
        await session.abortTransaction();
        return res.status(400).json({ success: false, message: 'variantId, quantity, and unitPrice required' });
      }

      if (quantity <= 0 || unitPrice < 0) {
        await session.abortTransaction();
        return res.status(400).json({ success: false, message: 'Invalid quantity or price' });
      }

      const variant = await Variant.findById(variantId).session(session);
      if (!variant || variant.status === 'Inactive') {
        await session.abortTransaction();
        return res.status(400).json({ success: false, message: `Invalid or inactive variant: ${variantId}` });
      }

      const oldItem = purchase.products.find(p => p.variantId.toString() === variantId.toString());
      const oldQty = oldItem ? oldItem.quantity : 0;
      const qtyDiff = quantity - oldQty;

      // If reducing quantity → check stock availability
      if (qtyDiff < 0 && variant.stockQuantity < Math.abs(qtyDiff)) {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: `Not enough stock to reduce quantity for ${variant.sku || variantId}`,
        });
      }

      const taxAmount = (unitPrice * quantity * taxPercent) / 100;
      const lineTotal = unitPrice * quantity + taxAmount;
      subtotal += lineTotal;

      newProductItems.push({
        variantId,
        quantity,
        unitPrice,
        taxPercent,
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
    // 4. PAYMENT HANDLING
    // ==================================================================
    const amountPaid = payment?.amountPaid !== undefined ? payment.amountPaid : purchase.payment.amountPaid;
    const amountDue = grandTotal - amountPaid;

    if (amountDue < 0) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: 'Overpayment not allowed' });
    }

    // ==================================================================
    // 5. FINAL STATUS LOGIC — SAME AS SALE (Secure & Smart)
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
      finalStatus = amountDue === 0
        ? 'Completed'
        : amountPaid > 0
          ? 'Partial'
          : 'Pending';
    }

    // Prevent downgrading from Completed
    if (purchase.status === 'Completed' && finalStatus !== 'Completed') {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: 'Cannot downgrade status from Completed' });
    }

    // ==================================================================
    // 6. RESTORE OLD STOCK FIRST
    // ==================================================================
    for (const old of purchase.products) {
      const stillExists = newProductItems.some(p => p.variantId.toString() === old.variantId.toString());
      const oldQty = old.quantity;

      if (!stillExists) {
        // Fully removed → return stock
        await Variant.findByIdAndUpdate(old.variantId, { $inc: { stockQuantity: -oldQty } }, { session });
      }
    }

    // ==================================================================
    // 7. APPLY NEW STOCK CHANGES
    // ==================================================================
    for (const item of newProductItems) {
      const oldItem = purchase.products.find(p => p.variantId.toString() === item.variantId.toString());
      const qtyDiff = oldItem ? item.quantity - oldItem.quantity : item.quantity;

      const stockUpdate = { $inc: { stockQuantity: qtyDiff } };
      if (!oldItem || oldItem.unitPrice !== item.unitPrice) {
        stockUpdate.$set = { purchasePrice: item.unitPrice };
      }

      await Variant.findByIdAndUpdate(item.variantId, stockUpdate, { session });
    }

    // ==================================================================
    // 8. SAVE PURCHASE
    // ==================================================================
    purchase.set({
      supplierId: supplierId || purchase.supplierId,
      products: newProductItems.map(p => ({
        variantId: p.variantId,
        quantity: p.quantity,
        unitPrice: p.unitPrice,
        taxPercent: p.taxPercent,
        taxAmount: p.taxAmount,
        lineTotal: p.lineTotal,
      })),
      summary: {
        subtotal,
        otherCharges: otherCharges || 0,
        discount: discount || 0,
        grandTotal,
      },
      payment: {
        amountPaid,
        amountDue,
        type: payment?.type || purchase.payment.type,
      },
      notes: notes !== undefined ? notes : purchase.notes,
      status: finalStatus,
      updatedAt: new Date(),
    });

    await purchase.save({ session });
    await session.commitTransaction();

    // ==================================================================
    // 9. RETURN POPULATED RESPONSE
    // ==================================================================
    const updatedPurchase = await Purchase.findById(id)
      .populate('supplierId', 'supplierName contact phone')
      .populate({
        path: 'products.variantId',
        populate: [
          { path: 'product', select: 'name' },
          { path: 'unit', select: 'short_name' },
        ],
      })
      .lean();

    return res.json({
      success: true,
      message: 'Purchase updated successfully',
      data: updatedPurchase,
    });

  } catch (error) {
    await session.abortTransaction();
    console.error('Update Purchase Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};



exports.deletePurchase = async (req, res) => {
  try {
    const { id } = req.params;
    const purchase = await Purchase.findByIdAndDelete(id);
    if (!purchase) return res.status(404).json({ success: softDeletedSale, message: 'Purchase not found' });

    // Decrease stock levels
    for (let prod of purchase.products) {
      await Variant.findByIdAndUpdate(prod.variantId, { $inc: { stockQuantity: -prod.quantity } });
    }

    res.status(200).json({ success: true, message: 'Purchase deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};