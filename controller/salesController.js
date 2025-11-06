const Sale = require('../model/Sales');
const Variant = require('../model/variantProduct');
const User = require('../model/User');

exports.createSale = async (req, res) => {
  try {
    const { date, customerId, products, summary, payment, notes } = req.body;

    // Validate required fields
    if (!customerId || !products || !summary) {
      return res.status(400).json({ status: false, message: 'Customer ID, products, and summary are required' });
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
      if (!variant || variant.status === 'Inactive' || variant.stockQuantity < prod.quantity) {
        return res.status(400).json({ status: false, message: `Insufficient stock or invalid variant: ${prod.variantId}` });
      }
      const taxAmount = (prod.price * prod.quantity * (prod.taxPercent || 0)) / 100 * (prod.taxType === 'Exclusive' ? 1 : 0);
      const productTotal = prod.price * prod.quantity + taxAmount;
      subTotal += productTotal;
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
    if (discount > subTotal) return res.status(400).json({ status: false, message: 'Discount cannot exceed subtotal' });
    if (grandTotal < 0) return res.status(400).json({ status: false, message: 'Grand total cannot be negative' });
    if (summary.subTotal && summary.subTotal !== subTotal) {
      return res.status(400).json({ status: false, message: 'Provided subTotal does not match calculated subTotal' });
    }
    if (summary.grandTotal && summary.grandTotal !== grandTotal) {
      return res.status(400).json({ status: false, message: 'Provided grandTotal does not match calculated grandTotal' });
    }

    // Validate payment
    if (payment) {
      if (typeof payment.amount !== 'number' || payment.amount < 0) {
        return res.status(400).json({ status: false, message: 'payment.amount must be a non-negative number' });
      }
      if (payment.type && !['Cash', 'Card', 'Online', 'BankTransfer'].includes(payment.type)) {
        return res.status(400).json({ status: false, message: 'Invalid payment type' });
      }
    }

    const amountPaid = payment?.amount || 0;
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

    // Create sale
    const sale = new Sale({
      saleCode,
      date: date && new Date(date) <= new Date() ? date : Date.now(),
      customerId,
      products: validatedProducts,
      payment: { 
        type: payment?.type || null, 
        amount: amountPaid, // Renamed to amountPaid for schema consistency
        amountDue, // Store in schema
        notes: payment?.notes || '' 
      },
      summary: { 
        totalQuantity, 
        subTotal, 
        discount, 
        otherCharges, 
        grandTotal 
      },
      notes: notes || '',
    });

    await sale.save();

    // Update inventory
    for (let prod of validatedProducts) {
      await Variant.findByIdAndUpdate(prod.variantId, { $inc: { stockQuantity: -prod.quantity } });
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
        ...populatedSale.toObject(),
        amountPaid: populatedSale.payment.amount,
        amountDue: populatedSale.payment.amountDue,
        products: populatedSale.products.map((product) => ({
          ...product.toObject(),
          productName: product.variantId?.product?.name || 'Unknown',
          image: product.variantId?.product?.thumbnail || product.variantId?.image || '',
          unit: product.variantId?.unit?.name || 'Unknown',
          quantity: product.quantity,
        })),
        customer: {
          id: populatedSale.customerId?._id,
          name: populatedSale.customerId?.name || 'Unknown',
          email: populatedSale.customerId?.email || '',
          phone: populatedSale.customerId?.phone || '',
        },
      }
    });
  } catch (error) {
    console.error('Error creating sale:', error);
    res.status(500).json({ status: false, message: 'Server error', error: error.message });
  }
};

exports.getAllSales = async (req, res) => {
  try {
    const { page = 1, limit = 10, startDate, endDate, paymentStatus, search } = req.query;
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
            '$payment.amount',
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
      .sort({ date: 1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('customerId', 'name email phone')
      .populate({
        path: 'products.variantId',
        select: 'sku attribute value unit purchasePrice price discountPrice stockQuantity expiryDate weightQuantity image',
        populate: [
          { path: 'product', select: 'name images thumbnail description' },
          { path: 'unit', select: 'name symbol' }
        ],
      })
      .lean();

    const total = await Sale.countDocuments(query);

    res.status(200).json({
      status: true,
      message: 'Sales fetched successfully',
      data: sales.map((sale) => ({
        id: sale._id,
        date: sale.date,
        saleCode: sale.saleCode,
        customer: {
          id: sale.customerId?._id,
          name: sale.customerId?.name || 'Unknown',
          email: sale.customerId?.email || '',
          phone: sale.customerId?.phone || '',
        },
        amountPaid: sale.payment.amount,
        amountDue: sale.payment.amountDue,
        grandTotal: sale.summary.grandTotal,
        paymentStatus: sale.payment.amount >= sale.summary.grandTotal ? 'Paid' : 'Pending',
        products: sale.products.map((product) => ({
          productName: product.variantId?.product?.name || 'Unknown',
          image: product.variantId?.product?.thumbnail || product.variantId?.image || '',
          unit: product.variantId?.unit?.name || 'Unknown',
          quantity: product.quantity,
          variantId: product.variantId?._id,
          sku: product.variantId?.sku,
          attribute: product.variantId?.attribute,
          value: product.variantId?.value,
          price: product.price,
          productDescription: product.variantId?.product?.description || '',
        })),
      })),
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

exports.updateSale = async (req, res) => {
  try {
    const { id } = req.params;
    const { date, customerId, products, summary, payment, notes } = req.body;

    const sale = await Sale.findById(id);
    if (!sale || sale.isDeleted) return res.status(404).json({ status: false, message: 'Sale not found' });

    // Validate required fields
    if (!customerId || !products || !summary) {
      return res.status(400).json({ status: false, message: 'Customer ID, products, and summary are required' });
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
    const newProducts = [];
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
      // Check stock including old quantity (to account for stock being restored)
      const oldProduct = sale.products.find(p => p.variantId.toString() === prod.variantId.toString());
      const availableStock = variant ? variant.stockQuantity + (oldProduct ? oldProduct.quantity : 0) : 0;
      if (!variant || variant.status === 'Inactive' || availableStock < prod.quantity) {
        return res.status(400).json({ status: false, message: `Insufficient stock or invalid variant: ${prod.variantId}` });
      }
      const taxAmount = (prod.price * prod.quantity * (prod.taxPercent || 0)) / 100 * (prod.taxType === 'Exclusive' ? 1 : 0);
      const productTotal = prod.price * prod.quantity + taxAmount;
      subTotal += productTotal;
      totalQuantity += prod.quantity;
      newProducts.push({ 
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
    if (discount > subTotal) return res.status(400).json({ status: false, message: 'Discount cannot exceed subtotal' });
    if (grandTotal < 0) return res.status(400).json({ status: false, message: 'Grand total cannot be negative' });
    if (summary.subTotal && summary.subTotal !== subTotal) {
      return res.status(400).json({ status: false, message: 'Provided subTotal does not match calculated subTotal' });
    }
    if (summary.grandTotal && summary.grandTotal !== grandTotal) {
      return res.status(400).json({ status: false, message: 'Provided grandTotal does not match calculated grandTotal' });
    }

    // Validate payment
    if (payment) {
      if (typeof payment.amount !== 'number' || payment.amount < 0) {
        return res.status(400).json({ status: false, message: 'payment.amount must be a non-negative number' });
      }
      if (payment.type && !['Cash', 'Card', 'Online', 'BankTransfer'].includes(payment.type)) {
        return res.status(400).json({ status: false, message: 'Invalid payment type' });
      }
    }

    const amountPaid = payment?.amount ?? sale.payment.amount;
    const amountDue = grandTotal - amountPaid;
    if (amountDue < 0) {
      return res.status(400).json({ status: false, message: 'Amount paid cannot exceed grand total' });
    }

    // Adjust inventory: Restore old quantities, then deduct new
    const oldProducts = sale.products;
    for (let oldProd of oldProducts) {
      const newProd = newProducts.find(p => p.variantId.toString() === oldProd.variantId.toString());
      const diff = newProd ? oldProd.quantity - newProd.quantity : oldProd.quantity; // Positive diff = restore stock
      if (diff !== 0) {
        await Variant.findByIdAndUpdate(oldProd.variantId, { $inc: { stockQuantity: diff } });
      }
    }

    // Log history
    sale.salesHistory.push({
      action: 'Update',
      changes: { date, customerId, products, summary, payment, notes },
      date: Date.now(),
    });

    // Update sale
    sale.set({
      date: date && new Date(date) <= new Date() ? date : sale.date,
      customerId,
      products: newProducts,
      payment: { 
        type: payment?.type ?? sale.payment.type, 
        amount: amountPaid, 
        amountDue, 
        notes: payment?.notes ?? sale.payment.notes 
      },
      summary: { 
        totalQuantity, 
        subTotal, 
        discount, 
        otherCharges, 
        grandTotal 
      },
      notes: notes ?? sale.notes,
    });
    await sale.save();

    // Populate response
    const updatedSale = await Sale.findById(id)
      .populate('customerId', 'name email phone')
      .populate({
        path: 'products.variantId',
        select: 'sku attribute value unit purchasePrice price discountPrice stockQuantity expiryDate weightQuantity image',
        populate: [
          { path: 'product', select: 'name images thumbnail description' },
          { path: 'unit', select: 'name symbol' }
        ],
      });

    res.status(200).json({ 
      status: true, 
      message: 'Sale updated successfully', 
      data: {
        ...updatedSale.toObject(),
        amountPaid: updatedSale.payment.amount,
        amountDue: updatedSale.payment.amountDue,
        products: updatedSale.products.map((product) => ({
          ...product.toObject(),
          productName: product.variantId?.product?.name || 'Unknown',
          image: product.variantId?.product?.thumbnail || product.variantId?.image || '',
          unit: product.variantId?.unit?.name || 'Unknown',
          quantity: product.quantity,
        })),
        customer: {
          id: updatedSale.customerId?._id,
          name: updatedSale.customerId?.name || 'Unknown',
          email: updatedSale.customerId?.email || '',
          phone: updatedSale.customerId?.phone || '',
        },
      }
    });
  } catch (error) {
    console.error('Error updating sale:', error);
    res.status(500).json({ status: false, message: 'Server error', error: error.message });
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
      data: {
        ...sale.toObject(),
        amountPaid: sale.payment.amount,
        amountDue: sale.payment.amountDue,
        products: sale.products.map((product) => ({
          ...product.toObject(),
          productName: product.variantId?.product?.name || 'Unknown',
          image: product.variantId?.product?.thumbnail || product.variantId?.image || '',
          unit: product.variantId?.unit?.name || 'Unknown',
          quantity: product.quantity,
        })),
        customer: {
          id: sale.customerId?._id,
          name: sale.customerId?.name || 'Unknown',
          email: sale.customerId?.email || '',
          phone: sale.customerId?.phone || '',
        },
      }
    });
  } catch (error) {
    console.error('Error fetching sale:', error);
    res.status(500).json({ status: false, message: 'Server error', error: error.message });
  }
};

exports.deleteSale = async (req, res) => {
  try {
    const { id } = req.params;
    const sale = await Sale.findById(id);
    if (!sale || sale.isDeleted) return res.status(404).json({ status: false, message: 'Sale not found' });

    sale.isDeleted = true;
    sale.salesHistory.push({
      action: 'Delete',
      changes: { isDeleted: true },
      date: Date.now(),
    });
    await sale.save();

    // Restore inventory
    for (let prod of sale.products) {
      await Variant.findByIdAndUpdate(prod.variantId, { $inc: { stockQuantity: prod.quantity } });
    }

    res.status(200).json({ status: true, message: 'Sale soft deleted successfully' });
  } catch (error) {
    console.error('Error deleting sale:', error);
    res.status(500).json({ status: false, message: 'Server error', error: error.message });
  }
};