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
                console.log("Agregando " + boletasImpagas.length + " boletas")
                return callback(null, boletasImpagas);
            }
            console.log("getBoletasImpagas err: " + err);
            callback(err, []);
        });
    }, function(err, entradas) {
        if (err == null ){
            //console.log(JSON.stringify(entradas, null, 4))
            var consolidado = [].concat.apply([],entradas);
            console.log("Exito. Entradas consolidadas:" + consolidado.length);
            console.log(JSON.stringify(consolidado));
            response.render('resultados', {'entradas': consolidado});
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

    //console.log("Buscando boletas de ruts: " + JSON.stringify(ruts));

    var nightmare = Nightmare({ show: false, electronPath: require('electron-prebuilt') });
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
    .evaluate(function (ruts) {
        var fieldsets = document.querySelectorAll('fieldset');
        var boletasImpagas = [];
        var fechaRegexp = new RegExp(/(\d{1,2})\/(\d{1,2})\/(\d{4})/)
        
        if (fieldsets == null) {
            console.log("fieldsets null");
        }
        
        fieldsets.forEach(function(fieldset) {
            var rut = null;
            var fecha = null;

            if (fieldset == null) {
                console.log("inner fieldset null");
            }

            fieldset.querySelectorAll('.txt_detalle_boleta').forEach(function(elem){
                if (elem == null) {
                    console.log("inner elem null");
                }

                var val = elem.innerText.trim();

                if (ruts.indexOf(val) != -1) {
                    rut = val;
                }
                else if(fechaRegexp.test(val)) {
                    fecha = val;
                }
            });

            if (rut != null && fecha != null) {
                boletasImpagas.push({'rut': rut, 'fecha': fecha});
            }
        });
        return boletasImpagas;
    }, ruts)
    .end()
    .then(function (result) {
        console.log(result);
        var entradas = [];

        // consolidar
        ruts.forEach(function(rut){
            var impagas = [];
            
            for(var i=0; i < result.length; i++) {
                if (result[i]['rut'] == rut) {
                    impagas.push(result[i]['fecha']);
                }
            }
            entradas.push({'rut': rut, 'cantidad': impagas.length, 'fechas': impagas.join(' - ')});
        });

        callback(null, entradas);
    })
    .catch(function (error) {
        console.error('Search failed:', error);
        callback(error);
    });

}