
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  Archive,
  Download,
  Filter,
  Plus,
  Search,
  X,
} from 'lucide-react';
import { api, friendlyError } from '../lib/api';
import { formatDate } from '../lib/dates';
import { EmptyState, Loading, Notice, StatusBadge } from '../components/UI';

const filters = [
  ['all', 'All products'],
  ['active', 'Active'],
  ['expiring', 'Expiring soon'],
  ['expired', 'Expired'],
  ['incomplete', 'Incomplete'],
];

function exportProducts(products) {
  const headers = [
    'Product Name',
    'Brand',
    'Model',
    'Warranty Status',
    'Warranty End Date',
  ];

  const escapeCSV = (value) =>
    `"${String(value ?? '').replace(/"/g, '""')}"`;

  const rows = products.map((product) => [
    product.name,
    product.brand,
    product.model,
    product.status,
    product.warrantyEndDate,
  ]);

  const csv = [
    headers,
    ...rows,
  ]
    .map((row) => row.map(escapeCSV).join(','))
    .join('\r\n');

  const blob = new Blob(['\uFEFF' + csv], {
    type: 'text/csv;charset=utf-8;',
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = `roof-products-${new Date()
    .toISOString()
    .slice(0, 10)}.csv`;

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}

export default function ProductsPage() {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('search') || '');
  const [products, setProducts] = useState(null);
  const [error, setError] = useState('');

  const status = params.get('status') || 'all';
  const query = params.get('search') || '';

  useEffect(() => {
    let active = true;

    api(
      `/products?search=${encodeURIComponent(query)}&status=${encodeURIComponent(status)}`
    )
      .then((d) => {
        if (active) {
          setProducts(d.products);
          setError('');
        }
      })
      .catch((err) => {
        if (active) setError(friendlyError(err));
      });

    return () => {
      active = false;
    };
  }, [query, status]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (search !== query)
        setParams((p) => {
          const next = new URLSearchParams(p);
          search ? next.set('search', search) : next.delete('search');
          return next;
        });
    }, 250);

    return () => clearTimeout(timeout);
  }, [search, query, setParams]);

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR COLLECTION</div>
          <h1>My products</h1>
          <p>All your purchases and warranties in one organized space.</p>
        </div>

        <Link to="/products/new" className="button button-primary">
          <Plus size={18} /> Add product
        </Link>
      </div>

      <section className="panel products-panel">
        <div className="products-toolbar">
          <div className="search-box">
            <Search size={19} />

            <input
              aria-label="Search products"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by product, brand or model..."
            />

            {search && (
              <button
                aria-label="Clear search"
                onClick={() => setSearch('')}
              >
                <X size={17} />
              </button>
            )}
          </div>

          <div className="filter-label">
            <Filter size={17} /> Filter by status
          </div>

          {products?.length > 0 && (
            <button
              type="button"
              className="button"
              onClick={() => exportProducts(products)}
            >
              <Download size={17} />
              Export CSV
            </button>
          )}
        </div>

        <div
          className="filter-tabs"
          role="tablist"
          aria-label="Warranty status"
        >
          {filters.map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={status === key}
              className={status === key ? 'selected' : ''}
              onClick={() =>
                setParams((p) => {
                  const next = new URLSearchParams(p);
                  key === 'all'
                    ? next.delete('status')
                    : next.set('status', key);
                  return next;
                })
              }
            >
              {label}
            </button>
          ))}
        </div>

        {error && <Notice type="error">{error}</Notice>}

        {!products && !error ? (
          <Loading />
        ) : products?.length ? (
          <div className="product-grid">
            {products.map((product) => (
              <Link
                className="product-card"
                to={`/products/${product.id}`}
                key={product.id}
              >
                <div className="product-card-top">
                  <div className="product-card-icon">
                    <Archive size={25} />
                  </div>

                  <StatusBadge status={product.status} />
                </div>

                <h3>{product.name}</h3>

                <p>
                  {product.brand}
                  {product.model ? ` · ${product.model}` : ''}
                </p>

                <div className="product-card-line" />

                <div className="product-card-bottom">
                  <span>
                    Warranty ends
                    <strong>
                      {formatDate(product.warrantyEndDate)}
                    </strong>
                  </span>

                  <span className="round-arrow">
                    <ArrowRight size={18} />
                  </span>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Archive}
            title={
              query || status !== 'all'
                ? 'No matching products'
                : 'Your vault is ready'
            }
            text={
              query || status !== 'all'
                ? 'Try another search or status filter.'
                : 'Add your first purchase to start keeping everything in one place.'
            }
            action={
              !query && status === 'all' ? (
                <Link to="/products/new" className="button button-primary">
                  <Plus size={17} /> Add product
                </Link>
              ) : null
            }
          />
        )}
      </section>
    </div>
  );
}
