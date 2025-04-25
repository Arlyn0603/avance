const sql = require("mssql");

const config = {
    user: "EventosDB", // Nombre de usuario proporcionado en Plesk
    password: "EventosDB1.", // Coloca aquí la contraseña que se muestra en Plesk (no se ve en la imagen)
    server: "tiusr16pl.cuc-carrera-ti.ac.cr", // Host de la base de datos en Plesk
    database: "EventosDB",
    options: {
        encrypt: true, // Importante activar para conexiones remotas
        trustServerCertificate: true // Esto depende de si el certificado es confiable o no
    }
};

const poolPromise = new sql.ConnectionPool(config)
    .connect()
    .then(pool => {
        console.log("✅ Conexión a SQL Server exitosa");
        return pool;
    })
    .catch(err => {
        console.error("❌ Error en la conexión a SQL Server", err);
    });

module.exports = {
    sql, poolPromise
};