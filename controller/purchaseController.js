const Purchase = require('../model/Purchase');
const Variant = require('../model/variantProduct');
const Supplier = require('../model/Supplier');
const mongoose = require('mongoose');
const user = require('../model/User')

const buildPurchaseProductRows = (purchase) => {
  return purchase.products.map(p => `
    <tr>
      <td>${p.variantId?.product?.name || "Product"}</td>
      <td align="center">${p.quantity}</td>
      <td align="right">${p.unitPrice}</td>
    </tr>
  `).join("");
};



exports.createPurchase = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { supplierId, products, summary, payment, notes, status } = req.body;

    if (!supplierId || !products || !Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ success: false, message: 'Supplier and products are required' });
    }

    const supplier = await Supplier.findById(supplierId);
    if (!supplier) {
      return res.status(400).json({ success: false, message: 'Invalid supplier' });
    }

    let subtotal = 0;
    const validatedProducts = [];

    for (const item of products) {
      const { variantId, quantity, unitPrice, taxPercent = 0 } = item;

      if (!variantId || !quantity || unitPrice === undefined) {
        return res.status(400).json({ success: false, message: 'variantId, quantity, and unitPrice are required' });
      }

      const variant = await Variant.findById(variantId).session(session);
      if (!variant || variant.status === 'Inactive') {
        return res.status(400).json({ success: false, message: `Variant not found: ${variantId}` });
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
        lineTotal
      });
    }

    const { otherCharges = 0, discount = 0 } = summary || {};
    const grandTotal = subtotal + otherCharges - discount;

    const amountPaid = payment?.amountPaid >= 0 ? payment.amountPaid : 0;
    const amountDue = grandTotal - amountPaid;

    let finalStatus = status;
    if (!finalStatus || finalStatus === 'Pending') {
      if (amountDue === 0) finalStatus = 'Completed';
      else if (amountPaid > 0) finalStatus = 'Partial';
      else finalStatus = 'Pending';
    }

    let purchaseCode = `PUR-${Date.now().toString(36).toUpperCase()}`;
    while (await Purchase.findOne({ purchaseCode })) {
      purchaseCode = `PUR-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substr(2, 3).toUpperCase()}`;
    }

    const purchase = new Purchase({
      purchaseCode,
      supplierId,
      products: validatedProducts,
      summary: {
        subtotal,
        otherCharges,
        discount,
        grandTotal
      },
      payment: {
        amountPaid,
        amountDue,
        type: payment?.type || null
      },
      notes: notes || '',
      status: finalStatus
    });

    await purchase.save({ session });

    // Update stock
    for (const item of validatedProducts) {
      const updateFields = { $inc: { stockQuantity: item.quantity } };

      const variant = await Variant.findById(item.variantId);
      if (variant.purchasePrice !== item.unitPrice) {
        updateFields.$set = { purchasePrice: item.unitPrice };
      }

      await Variant.findByIdAndUpdate(item.variantId, updateFields, { session });
    }

    

    await session.commitTransaction();

    const populatedPurchase = await Purchase.findById(purchase._id)
      .populate('supplierId', 'supplierName')
      .populate({
        path: 'products.variantId',
        populate: [
          { path: 'product', select: 'name' },
          { path: 'unit', select: 'short_name' }
        ]
      });

    // ===============================
    // 🔔 NOTIFICATIONS + EMAIL
    // ===============================
    try {
      const admins = await User.find({ role: { $in: ['Super Admin', 'Manager'] } })
        .select('_id email name')
        .lean();

      const currency = await getCurrencySettings();
      const grandTotalFormatted = `${currency.currencySign}${grandTotal.toFixed(2)}`;

      const productRows = buildPurchaseProductRows(populatedPurchase);

      for (const admin of admins) {
        await createNotification({
          userId: admin._id,
          type: 'purchase_created',
          title: 'New Purchase Created',
          message: `Purchase ${purchaseCode} • ${grandTotalFormatted} • ${finalStatus}`,
          related: { purchaseId: purchase._id.toString() }
        });

        if (admin.email) {
          const vars = {
            purchaseCode,
            supplierName: supplier.supplierName,
            subtotal: `${currency.currencySign}${subtotal.toFixed(2)}`,
            grandTotal: grandTotalFormatted,
            status: finalStatus,
            productRows,
            adminPurchaseUrl: `https://al-bready-admin.vercel.app/admin/purchases/${purchase._id}`
          };

          await sendEmail(admin.email, 'purchase_created_admin', vars);
        }
      }
    } catch (notifyErr) {
      console.error('Purchase notify/email error:', notifyErr);
    }

    res.status(201).json({
      success: true,
      message: 'Purchase created successfully',
      data: populatedPurchase
    });

  } catch (error) {
    await session.abortTransaction();
    console.error('Create Purchase Error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
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