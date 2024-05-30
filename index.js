const path = require("path");
const express = require("express");
const app = express();
const oracledb = require("oracledb");
const { connect } = require("http2");

// Set EJS as the view engine
app.set("view engine", "ejs");

// Define the directory where your HTML files (views) are located
app.set("views", path.join(__dirname, "views"));

// Optionally, you can define a static files directory (CSS, JS, images, etc.)
app.use(express.static(path.join(__dirname, "public")));

app.use(express.json());

app.use(express.urlencoded({ extended: true }));

// Define a route to render the HTML file
app.get("/", async (req, res) => {
  res.render("index"); // Assuming you have an "index.ejs" file in the "views" directory
});

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

let connection;

async function connectToDatabase() {
  try {
    connection = await oracledb.getConnection({
      user: "admin",
      password: "password",
      connectionString: "0.0.0.0:1522/XEPDB1",
    });
    console.log("Successfully connected to Oracle Database");
  } catch (err) {
    console.error(err);
  }
}

connectToDatabase().then(async () => {
  await setupDatabase();
  app.listen(3000, () => {
    console.log("Server started on http://localhost:3000");
  });
});

async function setupDatabase() {
  // Remove old tables, dev only.
  await connection.execute(
    `BEGIN
      execute immediate 'drop table users CASCADE CONSTRAINTS';
      execute immediate 'drop table accounts CASCADE CONSTRAINTS';
      execute immediate 'drop table transactions CASCADE CONSTRAINTS';
      exception when others then if sqlcode <> -942 then raise; end if;
      END;`
  );

  // Create new tables, dev only.
  await connection.execute(
    `create table users (
      id number generated always as identity,
      name varchar2(256),
      email varchar2(512),
      creation_ts timestamp with time zone default current_timestamp,
      accounts number,
      primary key (id)
    )`
  );
  await connection.execute(
    `create table accounts (
      id number generated always as identity,
      name varchar2(256),
      amount number,
      user_id number,
      transation_counter number,
      CONSTRAINT fk_user
      FOREIGN KEY (user_id)
      REFERENCES users (id),
      creation_ts timestamp with time zone default current_timestamp,
      primary key (id)
  )`
  );

  await connection.execute(
    `create table transactions (
        id number generated always as identity,
        name varchar2(256),
        amount number,
        type number(1) CHECK (type IN (0, 1)),
        account_id number,
        CONSTRAINT fk_account
        FOREIGN KEY (account_id)
        REFERENCES accounts (id),
        creation_ts timestamp with time zone default current_timestamp,
        primary key (id)
  )`
  );

  await connection.execute(
    `CREATE OR REPLACE PROCEDURE insert_user (
      p_user_name IN users.name%TYPE,
      p_user_email IN users.email%TYPE,
      p_user_id OUT users.id%TYPE
  ) AS
  BEGIN
      INSERT INTO users (name, email)
      VALUES (p_user_name, p_user_email)
      RETURNING id INTO p_user_id;
  END;`
  );

  await connection.execute(
    `CREATE OR REPLACE PROCEDURE insert_account (
        p_account_name IN accounts.name%TYPE,
        p_account_amount IN accounts.amount%TYPE,
        p_user_id IN accounts.user_id%TYPE,
        p_account_id OUT accounts.id%TYPE
        p_transaction_counter OUT accounts.transaction_counter%TYPE
    ) AS
    BEGIN
        INSERT INTO accounts (name, amount, user_id)
        VALUES (p_account_name, p_account_amount, p_user_id)
        RETURNING id INTO p_account_id;
    END;`
  );

  await connection.execute(
    `
    CREATE OR REPLACE PROCEDURE get_last_transaction_limit (
      p_account_id IN transactions.id%TYPE,
      p_bugdet IN accounts.budget%TYPE,
      
    ) AS
    )
    `
  )

  await connection.execute(
    `
    CREATE OR REPLACE FUNCTION format_name(name IN transactions.name%TYPE, transaction_type IN transactions.type%TYPE) RETURN VARCHAR2 IS 
    BEGIN
      RETURN 'T' || TO_CHAR(transaction_type) || '-' || UPPER(name);
    END;

    `
  );

  await connection.execute(
    `
    CREATE OR REPLACE PROCEDURE insert_transaction (
      p_transaction_name IN transactions.name%TYPE,
      p_transaction_amount IN transactions.amount%TYPE,
      p_transaction_type IN transactions.type%TYPE,
      p_account_id IN transactions.account_id%TYPE,
      p_transaction_id OUT transactions.id%TYPE
    ) AS
    BEGIN
      INSERT INTO transactions (name, amount, type, account_id)
      VALUES (format_name(p_transaction_name, p_transaction_type), p_transaction_amount, p_transaction_type, p_account_id)
      RETURNING id INTO p_transaction_id;

      UPDATE accounts
      SET amount = CASE
        WHEN p_transaction_type = 0 THEN amount - p_transaction_amount
        ELSE amount + p_transaction_amount
      END,
      transation_counter = transation_counter + 1
      WHERE id = p_account_id;
    END;
    `
  );

  await connection.execute(
    `    
    CREATE OR REPLACE PROCEDURE export_accounts_to_csv IS
      v_file UTL_FILE.FILE_TYPE;
      v_line VARCHAR2(32767);
    BEGIN
      v_file := UTL_FILE.FOPEN('EXPORT_DIR', 'accounts.csv', 'W');
    
      UTL_FILE.PUT_LINE(v_file, 'ID,NAME,AMOUNT,USER_ID');
    
      FOR rec IN (SELECT id, name, amount, user_id FROM accounts) LOOP
        v_line := rec.id || ',' || rec.name || ',' || rec.amount || ',' || rec.user_id;
            UTL_FILE.PUT_LINE(v_file, v_line);
        END LOOP;
    
         UTL_FILE.FCLOSE(v_file);
    EXCEPTION
         WHEN OTHERS THEN
           IF UTL_FILE.IS_OPEN(v_file) THEN
               UTL_FILE.FCLOSE(v_file);
            END IF;
            RAISE;
    END;
    `
  );

  await connection.execute(
    `
    CREATE OR REPLACE PROCEDURE read_file(p_filename IN VARCHAR2, p_file_content OUT CLOB) IS
  l_file UTL_FILE.FILE_TYPE;
  l_line VARCHAR2(32767);
BEGIN
  p_file_content := '';
  l_file := UTL_FILE.FOPEN('EXPORT_DIR', p_filename, 'R');

  LOOP
      BEGIN
          UTL_FILE.GET_LINE(l_file, l_line);
          p_file_content := p_file_content || l_line || CHR(10); -- CHR(10) is newline character

      EXCEPTION
          WHEN NO_DATA_FOUND THEN
              EXIT;
      END;
  END LOOP;

  UTL_FILE.FCLOSE(l_file);
EXCEPTION
  WHEN UTL_FILE.INVALID_PATH THEN
      RAISE_APPLICATION_ERROR(-20001, 'Invalid file path');
  WHEN UTL_FILE.READ_ERROR THEN
      RAISE_APPLICATION_ERROR(-20004, 'File read error');
  WHEN OTHERS THEN
      RAISE_APPLICATION_ERROR(-20005, 'An error occurred: ' || SQLERRM);
END read_file;
    `
  );

  // Insert some data
  const usersSql = `insert into users (name, email, accounts) values(:1, :2, :3)`;
  const usersRows = [
    ["Valentin Montagne", "contact@vm-it-consulting.com", 0],
    ["AmÃ©lie Dal", "amelie.dal@gmail.com", 0],
  ];
  let usersResult = await connection.executeMany(usersSql, usersRows);
  console.log(usersResult.rowsAffected, "Users rows inserted");
  const accountsSql = `insert into accounts (name, amount, user_id, transation_counter) values(:1, :2, :3, :4)`;
  const accountsRows = [["Compte courant", 2000, 1, 0]];
  let accountsResult = await connection.executeMany(accountsSql, accountsRows);
  console.log(accountsResult.rowsAffected, "Accounts rows inserted");
  connection.commit(); // Now query the rows back
}

app.get("/users", async (req, res) => {
  const getUsersSQL = `select * from users`;
  const result = await connection.execute(getUsersSQL);

  res.json(result.rows);
});

app.post("/users", async (req, res) => {
  const createUserSQL = `BEGIN
      insert_user(:name, :email, :user_id);
    END;`;
  const result = await connection.execute(createUserSQL, {
    name: req.body.name,
    email: req.body.email,
    user_id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
  });

  console.log(result);
  if (result.outBinds && result.outBinds.user_id) {
    res.redirect(`/views/${result.outBinds.user_id}`);
  } else {
    res.sendStatus(500);
  }
});

app.get("/views/:userId", async (req, res) => {
  const getCurrentUserSQL = `select * from users where id = :1`;
  const getAccountsSQL = `select * from accounts where user_id = :1`;
  const [currentUser, accounts] = await Promise.all([
    connection.execute(getCurrentUserSQL, [req.params.userId]),
    connection.execute(getAccountsSQL, [req.params.userId]),
  ]);

  console.log(accounts.rows);
  res.render("user-view", {
    currentUser: currentUser.rows[0],
    accounts: accounts.rows,
  });
});

app.get("/accounts", async (req, res) => {
  const getAccountsSQL = `select * from accounts`;

  try {
    const result = await connection.execute(getAccountsSQL);

    if (result.rows.length === 0) {
      res.status(404).send("No accounts found");
    } else {
      res.json(result.rows);
    }
  } catch (err) {
    console.error(err);
  }
});

app.post("/accounts", async (req, res) => {
  const createAccountSQL = `BEGIN
    insert_account(:name, :amount, :user_id, :account_id);
    END;`;

  try {
    const result = await connection.execute(createAccountSQL, {
      name: req.body.name,
      amount: req.body.amount,
      user_id: req.body.user_id,
      account_id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
    });

    if (result.outBinds && result.outBinds.account_id) {
      res.redirect(`/views/${req.body.user_id}`);
    } else {
      res.sendStatus(500);
    }
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

app.post("/transactions", async (req, res) => {
  const createTransactionSQL = `
    BEGIN
    insert_transaction(:name, :amount, :type, :account_id, :transaction_id);
    END;
    `;

  try {
    const result = await connection.execute(createTransactionSQL, {
      name: req.body.name,
      amount: req.body.amount,
      type: req.body.type,
      account_id: req.body.account_id,
      transaction_id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
    });

    if (result.outBinds && result.outBinds.transaction_id) {
      res.send(200).send(result.outBinds.transaction_id);
    }
  } catch (e) {
    console.log(e);
    res.sendStatus(500);
  }
});

app.get("/transactions", async (req, res) => {
  const getTransactionsSQL = `select * from transactions`;
  try {
    const result = await connection.execute(getTransactionsSQL);
    return res.json(result.rows);
  } catch (error) {
    res.status(500).send(error);
  }
});

app.get("/views/:userid/:accountId", async (req, res) => {
  const getUserAccounts = `select * from accounts where user_id = :1`;
  const getTransactionsSQL = `select * from transactions where account_id = :1`;
  try {
    await connection
      .execute(getUserAccounts, [req.params.userid])
      .then(async (result) => {
        if (result.rows.length === 0) {
          console.log("No accounts found");
          return res.status(404).send("No accounts found");
        } else {
          const resultTrasaction = await connection.execute(
            getTransactionsSQL,
            [req.params.accountId]
          );
          console.log("-----", resultTrasaction.rows);
          return res.render("transactions-view", {
            transactions: resultTrasaction.rows,
          });
        }
      });
  } catch (error) {
    res.status(500).send(error);
  }
});

app.post("/accounts/:accountId/export", async (req, res) => {
  const exportAccountsSQL = `BEGIN
    export_accounts_to_csv;
  END;`;
  await connection.execute(exportAccountsSQL);
  res.sendStatus(200);
});

app.get("/accounts/:accountId/export", async (req, res) => {
  const exportsSQL = `BEGIN
	read_file('accounts.csv', :content);
END;`;
  const result = await connection.execute(exportsSQL, {
    content: { dir: oracledb.BIND_OUT, type: oracledb.CLOB },
  });
  const data = await result.outBinds.content.getData();

  res.json({ content: data });
});


app.get('/accounts/:accountId/budgets/:amount', async (req, res) => {

});