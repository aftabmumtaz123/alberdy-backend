const Purchase = require('../model/Purchase');
const Variant = require('../model/variantProduct');
const Supplier = require('../model/Supplier');

exports.createPurchase = async (req, res) => {
  try {
    const { supplierId, products, summary, payment, notes } = req.body;

    // Validate summary object
    if (!summary || typeof summary !== 'object') {
      return res.status(400).json({ success: false, message: 'Summary object is required' });
    }
    const { otherCharges = 0, discount = 0 } = summary;

    // Validate otherCharges and discount
    if (typeof otherCharges !== 'number' || otherCharges < 0) {
      return res.status(400).json({ success: false, message: 'otherCharges must be a non-negative number' });
    }
    if (typeof discount !== 'number' || discount < 0) {
      return res.status(400).json({ success: false, message: 'discount must be a non-negative number' });
    }

    // Validate supplier
    const supplier = await Supplier.findById(supplierId);
    if (!supplier) {
      return res.status(400).json({ success: false, message: 'Invalid supplier' });
    }

    // Validate products array
    if (!Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ success: false, message: 'Products array is required and cannot be empty' });
    }

    let subtotal = 0;
    const validatedProducts = [];
    for (let prod of products) {
      // Validate product fields based on ProductPurchaseSchema
      if (!prod.variantId || !prod.quantity || !prod.unitPrice) {
        return res.status(400).json({ success: false, message: 'Each product must have variantId, quantity, and unitPrice' });
      }
      if (prod.quantity < 1 || prod.unitPrice < 0 || (prod.taxPercent && prod.taxPercent < 0)) {
        return res.status(400).json({ success: false, message: 'Invalid product data: quantity, unitPrice, or taxPercent' });
      }

      const variant = await Variant.findById(prod.variantId);
      if (!variant || variant.status === 'Inactive') {
        return res.status(400).json({ success: false, message: `Invalid or inactive variant: ${prod.variantId}` });
      }

      const taxAmount = (prod.unitPrice * prod.quantity * (prod.taxPercent || 0)) / 100;
      const productTotal = prod.unitPrice * prod.quantity + taxAmount;
      subtotal += productTotal;
      validatedProducts.push({
        variantId: prod.variantId,
        quantity: prod.quantity,
        unitPrice: prod.unitPrice,
        taxAmount,
        taxPercent: prod.taxPercent || 0,
      });
    }

    // Validate subtotal if provided
    if (summary.subtotal && summary.subtotal !== subtotal) {
      return res.status(400).json({ success: false, message: 'Provided subtotal does not match calculated subtotal' });
    }

    const grandTotal = subtotal + otherCharges - discount;
    if (grandTotal < 0) {
      return res.status(400).json({ success: false, message: 'Grand total cannot be negative' });
    }



    // Validate grandTotal if provided
    if (summary.grandTotal && summary.grandTotal !== grandTotal) {
      return res.status(400).json({ success: false, message: 'Provided grandTotal does not match calculated grandTotal' });
    }

    // Validate payment fields
    if (payment && (typeof payment.amountPaid !== 'number' || payment.amountPaid < 0)) {
      return res.status(400).json({ success: false, message: 'amountPaid must be a non-negative number' });
    }
    if (payment?.type && !['Cash', 'Card', 'Online', 'BankTransfer'].includes(payment.type)) {
      return res.status(400).json({ success: false, message: 'Invalid payment type' });
    }

   const amountPaid = payment?.amountPaid ?? 0;
const amountDue = grandTotal - amountPaid;

// Prevent overpayment
if (amountPaid > grandTotal) {
  return res.status(400).json({
    success: false,
    message: 'Paid amount cannot exceed grand total'
  });
}

// Ensure amountDue doesn’t go negative
const safeAmountDue = Math.max(0, amountDue);
    
    // cannot charge more than grand total
    if (amountDue < 0) {
      return res.status(400).json({ success: false, message: 'Amount paid cannot exceed grand total' });
    }
   

    // Generate unique purchase code
    let purchaseCode = `PUR-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    while (await Purchase.findOne({ purchaseCode })) {
      purchaseCode = `PUR-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    }

    //status update payment is completely done
    if (amountDue === 0) {
      req.body.status = 'Completed';
    }

    // Create purchase
    const purchase = new Purchase({
      purchaseCode,
      supplierId,
      products: validatedProducts,
      payment: {
        amountPaid,
        amountDue: safeAmountDue,
        type: payment?.type ?? null,
      },
      summary: {
        subtotal,
        otherCharges,
        discount,
        grandTotal,
      },
      notes: notes ?? '',
    });

    await purchase.save();

    // Update stock and purchase price
    for (let prod of validatedProducts) {
      const updateData = { $inc: { stockQuantity: prod.quantity } };
      if (prod.unitPrice !== (await Variant.findById(prod.variantId)).purchasePrice) {
        updateData.$set = { ...updateData.$set, purchasePrice: prod.unitPrice };
      }
      await Variant.findByIdAndUpdate(prod.variantId, updateData);
    }

    res.status(201).json({ success: true, message: 'Purchase created', data: purchase });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

exports.getAllPurchases = async (req, res) => {
  try {
    const { page = 1, limit  } = req.query;
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
            select: 'name images thumbnail description'
          },
          {
            path: 'unit',
            select: 'short_name'
          }
        ]
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
            select: 'name images thumbnail description'
          },
          {
            path: 'unit',
            select: 'short_name' 
          }
        ]
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
    const { supplierId, products, summary, status, payment, notes } = req.body;

    // Validate purchase ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid purchase ID' });
    }

    // Fetch purchase
    const purchase = await Purchase.findById(id).session(session);
    if (!purchase) {
      return res.status(404).json({ success: false, message: 'Purchase not found' });
    }

    // Validate summary object
    if (!summary || typeof summary !== 'object') {
      return res.status(400).json({ success: false, message: 'Summary object is required' });
    }
    const { otherCharges = 0, discount = 0 } = summary;
    if (typeof otherCharges !== 'number' || otherCharges < 0) {
      return res.status(400).json({ success: false, message: 'otherCharges must be a non-negative number' });
    }
    if (typeof discount !== 'number' || discount < 0) {
      return res.status(400).json({ success: false, message: 'discount must be a non-negative number' });
    }

    // Validate supplier
    if (supplierId) {
      const supplier = await Supplier.findById(supplierId).session(session);
      if (!supplier) {
        return res.status(400).json({ success: false, message: 'Invalid supplier' });
      }
    }

    // Validate status
    if (status && !['Pending', 'Completed', 'Cancelled'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Status must be one of: Pending, Completed, Cancelled' });
    }

    let newProducts = [];
    let subtotal = 0;

    // Handle cancellation
    if (status === 'Cancelled' && purchase.status !== 'Cancelled') {
      // Remove all stock added by this purchase
      for (const product of purchase.products) {
        if (product.variantId && mongoose.Types.ObjectId.isValid(product.variantId)) {
          const variant = await Variant.findById(product.variantId).session(session);
          if (!variant) {
            await session.abortTransaction();
            return res.status(400).json({ success: false, message: `Invalid variant: ${product.variantId}` });
          }
          if (variant.stockQuantity < product.quantity) {
            await session.abortTransaction();
            return res.status(400).json({ success: false, message: `Insufficient stock to cancel for variant ${product.variantId}` });
          }
          await Variant.findByIdAndUpdate(
            product.variantId,
            { $inc: { stockQuantity: -product.quantity } },
            { runValidators: true, session }
          );
          console.log(`Removed ${product.quantity} units from variant ${product.variantId} for purchase ${purchase.purchaseCode}`);
        }
      }
      // Clear products and reset financials
      newProducts = [];
      purchase.products = [];
      purchase.payment.amountDue = 0;
      purchase.payment.amountPaid = 0;
      purchase.summary.subtotal = 0;
      purchase.summary.grandTotal = 0;
    } else {
      // Validate products for non-cancelled purchases
      if (!Array.isArray(products) || products.length === 0) {
        return res.status(400).json({ success: false, message: 'Products array is required and cannot be empty for non-cancelled purchases' });
      }

      for (const prod of products) {
        if (!prod.variantId || !prod.quantity || !prod.unitPrice) {
          return res.status(400).json({ success: false, message: 'Each product must have variantId, quantity, and unitPrice' });
        }
        if (prod.quantity < 1 || prod.unitPrice < 0 || (prod.taxPercent && prod.taxPercent < 0)) {
          return res.status(400).json({ success: false, message: 'Invalid product data: quantity, unitPrice, or taxPercent' });
        }

        const variant = await Variant.findById(prod.variantId).session(session);
        if (!variant || variant.status === 'Inactive') {
          await session.abortTransaction();
          return res.status(400).json({ success: false, message: `Invalid or inactive variant: ${prod.variantId}` });
        }

        const oldProduct = purchase.products.find(p => p.variantId.toString() === prod.variantId.toString());
        const stockChange = oldProduct ? prod.quantity - oldProduct.quantity : prod.quantity;
        if (stockChange < 0 && variant.stockQuantity < -stockChange) {
          await session.abortTransaction();
          return res.status(400).json({ success: false, message: `Insufficient stock to reduce for variant ${prod.variantId}` });
        }

        const taxAmount = (prod.unitPrice * prod.quantity * (prod.taxPercent || 0)) / 100;
        const productTotal = prod.unitPrice * prod.quantity + taxAmount;
        subtotal += productTotal;
        newProducts.push({
          variantId: prod.variantId,
          quantity: prod.quantity,
          unitPrice: prod.unitPrice,
          taxAmount,
          taxPercent: prod.taxPercent || 0,
        });
      }

      // Adjust stock
      for (const oldProd of purchase.products) {
        const newProd = newProducts.find(p => p.variantId.toString() === oldProd.variantId.toString());
        const diff = newProd ? newProd.quantity - oldProd.quantity : -oldProd.quantity;
        if (diff !== 0 && oldProd.variantId && mongoose.Types.ObjectId.isValid(oldProd.variantId)) {
          const variant = await Variant.findById(oldProd.variantId).session(session);
          if (!variant) {
            await session.abortTransaction();
            return res.status(400).json({ success: false, message: `Invalid variant: ${oldProd.variantId}` });
          }
          if (diff < 0 && variant.stockQuantity < -diff) {
            await session.abortTransaction();
            return res.status(400).json({ success: false, message: `Insufficient stock to reduce for variant ${oldProd.variantId}` });
          }
          await Variant.findByIdAndUpdate(
            oldProd.variantId,
            { $inc: { stockQuantity: diff } },
            { runValidators: true, session }
          );
          console.log(`Adjusted ${diff} units for variant ${oldProd.variantId} for purchase ${purchase.purchaseCode}`);
        }
      }
    }

    // Validate summary
    const grandTotal = subtotal + otherCharges - discount;
    if (grandTotal < 0) {
      return res.status(400).json({ success: false, message: 'Grand total cannot be negative' });
    }
    if (summary.subtotal && summary.subtotal !== subtotal) {
      return res.status(400).json({ success: false, message: 'Provided subtotal does not match calculated subtotal' });
    }
    if (summary.grandTotal && summary.grandTotal !== grandTotal) {
      return res.status(400).json({ success: false, message: 'Provided grandTotal does not match calculated grandTotal' });
    }

    // Validate payment
    const amountPaid = payment?.amountPaid ?? purchase.payment.amountPaid;
    const amountDue = grandTotal - amountPaid;
    if (payment && (typeof payment.amountPaid !== 'number' || payment.amountPaid < 0)) {
      return res.status(400).json({ success: false, message: 'amountPaid must be a non-negative number' });
    }
    if (payment?.type && !['Cash', 'Card', 'Online', 'BankTransfer'].includes(payment.type)) {
      return res.status(400).json({ success: false, message: 'Invalid payment type' });
    }
    if (amountDue < 0) {
      return res.status(400).json({ success: false, message: 'Amount paid cannot exceed grand total' });
    }

    // Update status if fully paid
    const newStatus = amountDue === 0 ? 'Completed' : (status ?? purchase.status);

    // Update purchase
    purchase.set({
      supplierId: supplierId ?? purchase.supplierId,
      products: newProducts,
      payment: {
        amountPaid,
        amountDue,
        type: payment?.type ?? purchase.payment.type,
      },
      summary: {
        subtotal,
        otherCharges,
        discount,
        grandTotal,
      },
      notes: notes ?? purchase.notes,
      status: newStatus,
    });

    await purchase.save({ session });

    // Populate response
    const updatedPurchase = await Purchase.findById(id)
      .populate('supplierId', 'supplierName')
      .populate({
        path: 'products.variantId',
        select: 'sku attribute value unit purchasePrice price discountPrice stockQuantity expiryDate weightQuantity image',
        populate: [
          { path: 'product', select: 'name images thumbnail description' },
          { path: 'unit', select: 'short_name' },
        ],
      })
      .session(session);

    await session.commitTransaction();
    res.status(200).json({
      success: true,
      message: 'Purchase updated successfully',
      data: updatedPurchase,
    });
  } catch (error) {
    await session.abortTransaction();
    console.error('Error updating purchase:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  } finally {
    session.endSession();
  }
};


exports.deletePurchase = async (req, res) => {
  try {
    const { id } = req.params;
    const purchase = await Purchase.findByIdAndDelete(id);
    if (!purchase) return res.status(404).json({ success: false, message: 'Purchase not found' });

    // Decrease stock levels
    for (let prod of purchase.products) {
      await Variant.findByIdAndUpdate(prod.variantId, { $inc: { stockQuantity: -prod.quantity } });
    }

    res.status(200).json({ success: true, message: 'Purchase deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }

};







