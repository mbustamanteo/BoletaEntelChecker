'use strict';

var express = require('express');
var exphbs  = require('express-handlebars');
var app = express();
var bodyParser = require('body-parser');
var async = require('async');
var Nightmare = require('nightmare');   

app.engine('handlebars', exphbs({defaultLayout: 'main'}));
app.set('view engine', 'handlebars');
app.set('port', (process.env.PORT || 5000));
app.use(express.static(__dirname + '/public'));
app.use(bodyParser.urlencoded({ extended: true })); 
app.set('views', __dirname + '/views');

app.get('/', function(request, response) {
    response.render('index');
});

app.post('/boletas', function(request, response) {
    var ruts = request.body.ruts;
    
    if (ruts == null) {
        response.status(400).send('no hay ruts');
        return
    }

    ruts = ruts.trim().split(",");
    var pedazos = [];
    var tamano = 20;

    // dividir en pedazos de 15
    for(var i = 0; i < ruts.length; i += tamano) {
        pedazos.push(ruts.slice(i, i+tamano));
    }

    console.log("Buscando boletas de " + ruts.length + " ruts");
    console.log("Separados en " + pedazos.length + " pedazos");

    async.mapLimit(pedazos, 10, function(pedazo, callback) {
        getBoletasImpagas(pedazo, function(err, boletasImpagas) {
            if (err == null) {
                //console.log("Agregando boletas: " + JSON.stringify(boletasImpagas, null, 4));
                console.log("Agregando " + boletasImpagas['boletas'].length + " boletas")
                return callback(null, boletasImpagas);
            }
            console.log("getBoletasImpagas err: " + err);
            callback(err, []);
        });
    }, function(err, entradas) {
        if (err == null ){
            //console.log(JSON.stringify(entradas, null, 4))
            var consolidado = [];
            var invalidos = [];
            var hayInvalidos = false;
            
            for (var i = 0; i < entradas.length; i++) {
                consolidado = consolidado.concat(entradas[i]['entradas']);
                invalidos = invalidos.concat(entradas[i]['invalidos']);
            }
            
            // determina si se muestra o no la tabla con ruts invalidos
            hayInvalidos = invalidos.length != 0

            console.log("Exito. Entradas consolidadas: " + consolidado.length + ". Invalidos: " + invalidos.length);
            //console.log(JSON.stringify(consolidado));
            response.render('resultados', {'entradas': consolidado, 'invalidos': invalidos, 'hayinvalidos': hayInvalidos});
        }
        else {
            response.status(500).send('error');
        }
    });
});

app.listen(app.get('port'), function() {
    console.log('Node app BEC is running on port', app.get('port'))
});



function getBoletasImpagas(ruts, callback) {   

    console.log("Buscando boletas de ruts: " + JSON.stringify(ruts));

    var nightmare = Nightmare({ show: false });
    var operations = nightmare.goto('https://www.servipag.com/').wait('input#identificador');

    ruts.forEach(function(rut) {
    operations = operations
        .select('select#servicios.txt_formulario', '29')
        .wait(200)
        .select('select#billers', '700')
        .insert('input#identificador',rut)
        .click('#formPagoCuentas a[href^="javascript:AgregarCuentasaPagar"]')
        .wait(10)
    });

    operations
    .click('#formPagoCuentas a[href^="javascript:enviar"]')
    .wait('fieldset')
    .wait(50)
    .evaluate(function (ruts) {
        var fieldsets = document.querySelectorAll('fieldset');
        var boletasImpagas = [];
        var rutsInvalidos = [];
        var fechaRegexp = new RegExp(/(\d{1,2})\/(\d{1,2})\/(\d{4})/)
        
        if (fieldsets == null) {
            console.log("fieldsets null");
        }
        else {
            console.log("Encontrados " + fieldsets.length + "fieldsets");
        }
        
        fieldsets.forEach(function(fieldset) {
            var rut = null;
            var fecha = null;

            fieldset.querySelectorAll('.txt_detalle_boleta').forEach(function(elem){
                var val = elem.innerText.trim();

                if (ruts.indexOf(val) != -1) {
                    rut = val;
                }
                else if(fechaRegexp.test(val)) {
                    fecha = val;
                }
            });

            if (rut != null && fecha != null) {
                // conseguir monto
                var monto = 0;

                fieldset.querySelectorAll('.txt_detalle_boleta_bold').forEach(function(elem){
                  var val = elem.innerText.trim();
                  if (val.indexOf("$") != -1) {
                      monto = Number(val.replace(/\D/g,''));
                  }
                });

                boletasImpagas.push({'rut': rut, 'fecha': fecha, 'monto': monto});
            }
            else if (rut != null){
              // si no encontramos boletas, quizas es invalido
              fieldset.querySelectorAll('.txt_detalle_boleta_bold').forEach(function(elem){
                  var val = elem.innerText.trim();
                  if (val.indexOf("En estos momentos no es posible obtener la informacion") != -1) {
                    rutsInvalidos.push(rut)
                  }
              });
            }
        });
        return {'boletas': boletasImpagas, 'invalidos': rutsInvalidos};
    }, ruts)
    .end()
    .then(function (result) {
        console.log(result);
        var entradas = [];

        var boletas = result.boletas;
        var invalidos = result.invalidos;

        // consolidar
        ruts.forEach(function(rut){
            var impagas = [];
            var monto = 0;
            
            for(var i=0; i < boletas.length; i++) {
                if (boletas[i]['rut'] == rut) {
                    impagas.push(boletas[i]['fecha']);
                    monto += boletas[i]['monto'];
                }
            }
            entradas.push({'rut': rut, 'cantidad': impagas.length, 'fechas': impagas.join(' - '), 'monto': monto});
        });

        callback(null, {'entradas': entradas, 'invalidos': invalidos});
    })
    .catch(function (error) {
        console.error('Search failed:', error);
        callback(error);
    });

}
