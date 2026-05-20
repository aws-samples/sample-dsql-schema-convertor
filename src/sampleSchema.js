export const SAMPLE_SCHEMAS = {
    postgresql: `-- Sample PostgreSQL schema for an e-commerce application

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

CREATE SEQUENCE order_id_seq START 1000;

CREATE TABLE customers (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE products (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    price DECIMAL(10,2) NOT NULL,
    stock_count INTEGER DEFAULT 0,
    category_id INT REFERENCES categories(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE orders (
    id INTEGER DEFAULT nextval('order_id_seq') PRIMARY KEY,
    customer_id INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    status VARCHAR(50) DEFAULT 'pending',
    total DECIMAL(10,2) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    shipped_at TIMESTAMP,
    CONSTRAINT fk_customer FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE order_items (
    id SERIAL PRIMARY KEY,
    order_id INT NOT NULL,
    product_id INT NOT NULL,
    quantity INT NOT NULL DEFAULT 1,
    unit_price DECIMAL(10,2) NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_order_items_order ON order_items(order_id);

-- Trigger function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at
    BEFORE UPDATE ON customers
    FOR EACH ROW
    EXECUTE FUNCTION update_modified_column();

-- SQL function (supported in DSQL)
CREATE OR REPLACE FUNCTION get_order_total(order_id INT)
RETURNS DECIMAL AS $$
    SELECT COALESCE(SUM(quantity * unit_price), 0)
    FROM order_items WHERE order_items.order_id = get_order_total.order_id;
$$ LANGUAGE SQL;

-- PL/pgSQL procedure (not supported in DSQL)
CREATE OR REPLACE FUNCTION place_order(
    p_customer_id INT,
    p_items JSONB
) RETURNS INT AS $$
DECLARE
    v_order_id INT;
BEGIN
    INSERT INTO orders (customer_id, total)
    VALUES (p_customer_id, 0)
    RETURNING id INTO v_order_id;

    RETURN v_order_id;
END;
$$ LANGUAGE plpgsql;`,

    mysql: `-- Sample MySQL schema for an e-commerce application

CREATE TABLE customers (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    email VARCHAR(255) NOT NULL,
    name VARCHAR(100) NOT NULL,
    status ENUM('active', 'inactive', 'suspended') DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY idx_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE products (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    \`name\` VARCHAR(200) NOT NULL,
    description LONGTEXT,
    price DECIMAL(10,2) NOT NULL,
    stock_count INT UNSIGNED DEFAULT 0,
    category_id INT UNSIGNED,
    image_data MEDIUMBLOB,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_category (category_id),
    CONSTRAINT fk_product_category FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 ROW_FORMAT=DYNAMIC;

CREATE TABLE orders (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    customer_id INT UNSIGNED NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    total DECIMAL(10,2) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    shipped_at DATETIME,
    PRIMARY KEY (id),
    KEY idx_customer (customer_id),
    KEY idx_status (status),
    CONSTRAINT fk_order_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE order_items (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    order_id INT UNSIGNED NOT NULL,
    product_id INT UNSIGNED NOT NULL,
    quantity INT UNSIGNED NOT NULL DEFAULT 1,
    unit_price DECIMAL(10,2) NOT NULL,
    PRIMARY KEY (id),
    KEY idx_order (order_id),
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id)
) ENGINE=InnoDB;

DELIMITER //
CREATE TRIGGER update_customer_timestamp
    BEFORE UPDATE ON customers
    FOR EACH ROW
BEGIN
    SET NEW.updated_at = NOW();
END//
DELIMITER ;

DELIMITER //
CREATE PROCEDURE place_order(IN p_customer_id INT, IN p_total DECIMAL(10,2))
BEGIN
    INSERT INTO orders (customer_id, total) VALUES (p_customer_id, p_total);
    SELECT LAST_INSERT_ID() AS order_id;
END//
DELIMITER ;`,

    oracle: `-- Sample Oracle schema for an e-commerce application

CREATE SEQUENCE customer_seq START WITH 1 INCREMENT BY 1 NOCACHE NOCYCLE;
CREATE SEQUENCE order_seq START WITH 1000 INCREMENT BY 1 NOCACHE;

CREATE TABLE customers (
    id NUMBER(10) NOT NULL,
    email VARCHAR2(255 CHAR) NOT NULL,
    name VARCHAR2(100 CHAR) NOT NULL,
    bio CLOB,
    created_at DATE DEFAULT SYSDATE,
    updated_at DATE DEFAULT SYSDATE,
    CONSTRAINT pk_customers PRIMARY KEY (id),
    CONSTRAINT uk_customer_email UNIQUE (email)
)
TABLESPACE users
STORAGE (INITIAL 64K NEXT 64K)
PCTFREE 10 INITRANS 2;

CREATE TABLE products (
    id NUMBER(19) NOT NULL,
    name VARCHAR2(200 CHAR) NOT NULL,
    description CLOB,
    price NUMBER(10,2) NOT NULL,
    weight BINARY_FLOAT,
    stock_count NUMBER(10) DEFAULT 0,
    category_id NUMBER(10),
    image_data BLOB,
    created_at DATE DEFAULT SYSDATE,
    CONSTRAINT pk_products PRIMARY KEY (id),
    CONSTRAINT fk_product_category FOREIGN KEY (category_id) REFERENCES categories(id)
)
TABLESPACE users
NOCOMPRESS LOGGING;

CREATE TABLE orders (
    id NUMBER(10) DEFAULT order_seq.NEXTVAL NOT NULL,
    customer_id NUMBER(10) NOT NULL,
    status VARCHAR2(50) DEFAULT 'pending',
    total NUMBER(10,2) NOT NULL,
    created_at DATE DEFAULT SYSDATE,
    shipped_at DATE,
    CONSTRAINT pk_orders PRIMARY KEY (id),
    CONSTRAINT fk_order_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
)
SEGMENT CREATION IMMEDIATE;

CREATE INDEX idx_orders_customer ON orders(customer_id) TABLESPACE users;
CREATE INDEX idx_orders_status ON orders(status);

CREATE OR REPLACE FUNCTION get_order_total(p_order_id IN NUMBER)
RETURN NUMBER
IS
    v_total NUMBER;
BEGIN
    SELECT NVL(SUM(quantity * unit_price), 0)
    INTO v_total
    FROM order_items
    WHERE order_id = p_order_id;

    RETURN v_total;
END get_order_total;
/

CREATE OR REPLACE TRIGGER trg_customer_updated
    BEFORE UPDATE ON customers
    FOR EACH ROW
BEGIN
    :NEW.updated_at := SYSDATE;
END;
/

CREATE PUBLIC SYNONYM customers_syn FOR app_schema.customers;

CREATE DATABASE LINK remote_warehouse
    CONNECT TO warehouse_user IDENTIFIED BY secret
    USING 'WAREHOUSE_DB';`,

    sqlserver: `-- Sample SQL Server schema for an e-commerce application

SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE TABLE [dbo].[customers] (
    [id] INT IDENTITY(1,1) NOT NULL,
    [email] NVARCHAR(255) NOT NULL,
    [name] NVARCHAR(100) NOT NULL,
    [bio] NVARCHAR(MAX),
    [is_active] BIT DEFAULT 1,
    [balance] MONEY DEFAULT 0,
    [created_at] DATETIME2 DEFAULT GETDATE(),
    [updated_at] DATETIME2 DEFAULT GETDATE(),
    CONSTRAINT [PK_customers] PRIMARY KEY CLUSTERED ([id] ASC)
        WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF)
) ON [PRIMARY]
TEXTIMAGE_ON [PRIMARY]
GO

CREATE UNIQUE NONCLUSTERED INDEX [IX_customers_email]
    ON [dbo].[customers] ([email] ASC)
    WITH (PAD_INDEX = OFF, FILLFACTOR = 90)
GO

CREATE TABLE [dbo].[products] (
    [id] BIGINT IDENTITY(1,1) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [description] NVARCHAR(MAX),
    [price] DECIMAL(10,2) NOT NULL,
    [stock_count] INT DEFAULT 0,
    [category_id] INT NULL,
    [sku] UNIQUEIDENTIFIER DEFAULT NEWID(),
    [image_data] VARBINARY(MAX),
    [created_at] DATETIMEOFFSET DEFAULT GETDATE(),
    CONSTRAINT [PK_products] PRIMARY KEY CLUSTERED ([id] ASC),
    CONSTRAINT [FK_products_category] FOREIGN KEY ([category_id])
        REFERENCES [dbo].[categories] ([id]) ON DELETE SET NULL
) ON [PRIMARY]
GO

CREATE TABLE [dbo].[orders] (
    [id] INT IDENTITY(1,1) NOT NULL,
    [customer_id] INT NOT NULL,
    [status] NVARCHAR(50) DEFAULT N'pending',
    [total] MONEY NOT NULL,
    [created_at] DATETIME2 DEFAULT GETDATE(),
    [shipped_at] DATETIME2 NULL,
    CONSTRAINT [PK_orders] PRIMARY KEY CLUSTERED ([id] ASC),
    CONSTRAINT [FK_orders_customer] FOREIGN KEY ([customer_id])
        REFERENCES [dbo].[customers] ([id]) ON DELETE CASCADE
) ON [PRIMARY]
GO

CREATE NONCLUSTERED INDEX [IX_orders_customer] ON [dbo].[orders] ([customer_id])
GO
CREATE NONCLUSTERED INDEX [IX_orders_status] ON [dbo].[orders] ([status])
GO

CREATE PROCEDURE [dbo].[place_order]
    @customer_id INT,
    @total MONEY
AS
BEGIN
    SET NOCOUNT ON;
    INSERT INTO orders (customer_id, total)
    VALUES (@customer_id, @total);
    SELECT SCOPE_IDENTITY() AS order_id;
END
GO

CREATE FUNCTION [dbo].[get_order_total](@order_id INT)
RETURNS MONEY
WITH SCHEMABINDING
AS
BEGIN
    DECLARE @total MONEY;
    SELECT @total = ISNULL(SUM(quantity * unit_price), 0)
    FROM dbo.order_items WHERE order_id = @order_id;
    RETURN @total;
END
GO`
};

export const SAMPLE_SCHEMA = SAMPLE_SCHEMAS.postgresql;
