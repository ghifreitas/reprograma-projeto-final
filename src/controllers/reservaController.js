const mongoose = require('mongoose');
const {getUserEmail} = require('./authController'); 

const ReservaSchema = require("../models/reservaModel");
const MesaSchema = require("../models/mesaModel");
const UserSchema = require("../models/userModel");

async function checarMesas(qtd) {
    return (await MesaSchema.find({capacidade: {$gte: qtd}})).map(m => m.numero);
}

async function checarMesasRequest(req, res) {
    const {dataInicio, dataFim, quantidade} = req.body
    const mesas = await checarMesas(quantidade);
    const horarioInicio = new Date(dataInicio);
    const horarioFim = new Date(dataFim);

    const mesasOcupadas = await checarMesaDisponivelIntervalo(horarioInicio, horarioFim);

    for (const mesaocupada of mesasOcupadas) {
        const indice = mesas.indexOf(mesaocupada);
        if( indice !== -1 ) {
            mesas.splice(indice, 1);
        }
    }

    res.send({
        mesas: mesas,
        mesasOcupadas
    });
}

async function checarMesaDisponivel(horarioInicio, horarioFim, quantidade) {
    const mesas = await checarMesas(quantidade);
    if( !mesas.length ) return null;
    
    const mesasOcupadas = await checarMesaDisponivelIntervalo(horarioInicio, horarioFim);

    for (const mesaocupada of mesasOcupadas) {
        const indice = mesas.indexOf(mesaocupada);
        if( indice !== -1 ) {
            mesas.splice(indice, 1);
        }
    }

    if( !mesas.length ) return null;

    return mesas[0];
}

async function checarMesaDisponivelIntervalo(horarioInicio, horarioFim) {
    const reservasCruzamInicio = await ReservaSchema.find({
        horarioInicio: {$lte: horarioInicio},
        horarioFim: {$gt: horarioInicio},
    }); 

    const reservasCruzamFim = await ReservaSchema.find({
        horarioInicio: {$lte: horarioFim},
        horarioFim: {$gt: horarioFim},
    }); 
    
    return [...reservasCruzamInicio.map(r => r.numeroDaMesa), ...reservasCruzamFim.map(r => r.numeroDaMesa)];
}

async function criarReserva(dadosReserva, req, res){
    
    try{
        const responsavel = await UserSchema.findOne({email: dadosReserva.responsavel, tipo: "CLIENTE"});

        if( !responsavel ) {
            return res.status(404).json({
                message: "O respons??vel n??o existe"
            });
        }
        
        if( dadosReserva.quantidadeDePessoas <= 0) {
            return res.status(400).json({
                message: "N??mero de pessoas inv??lido"
            });
        }

        if( dadosReserva.horarioFim <= dadosReserva.horarioInicio.getTime() ) {
            return res.status(400).json({
                message: "Intervalo inv??lido"
            });
        }

        if( dadosReserva.horarioFim <= new Date() ){
            return res.status(400).json({
                message: "N??o pode reservar algo para o passado"
            });
        }

        // limite do hor??rio de reserva - 4h
        if( dadosReserva.horarioFim.getTime() - dadosReserva.horarioInicio.getTime() > 4 * 60 * 60 * 1000 ) {
            return res.status(400).json({
                message: "Intervalo de reserva maior do que o permitido"
            });
        }

        let mesa = null;
        mesa = await checarMesaDisponivel(dadosReserva.horarioInicio, dadosReserva.horarioFim, dadosReserva.quantidadeDePessoas);

        if( !mesa ) {
            return res.status(404).json({
                message: "Mesa inexistente"
            });
        }

        if( mesa.capacidade < dadosReserva.quantidadeDePessoas) {
            return res.status(404).json({
                message: "Inexiste mesa para comportar esta quantidade de pessoas"
            });
        }

        dadosReserva.numeroDaMesa = mesa;

        const reserva = new ReservaSchema(dadosReserva)
        const reservaSalva = await reserva.save();
        res.status(201).json({
            reserva: reservaSalva
        })

    }catch(error){
        res.status(400).json({
            message: error.message
        })
    }
}

const criarReservaCliente = async(req, res) => {
    const {quantidadeDePessoas, horarioInicio, horarioFim } = req.body;
    const email = getUserEmail(req, res); // TODO: check e-mail
    const dadosReserva = {
        quantidadeDePessoas, 
        horarioInicio: new Date(horarioInicio), 
        horarioFim: new Date(horarioFim), 
        responsavel: email
    };
    return criarReserva(dadosReserva, req, res);
}

const criarReservaGerente = async(req, res) => {
    const {quantidadeDePessoas, horarioInicio, horarioFim, responsavel } = req.body;
    const dadosReserva = {
        quantidadeDePessoas, 
        horarioInicio: new Date(horarioInicio), 
        horarioFim: new Date(horarioFim), 
        responsavel
    };
    return criarReserva(dadosReserva, req, res);
}

const listarReservas = async(req, response) => {
    //const {nome} = req.query;

    let query = { };

    //if (nome) query.nome = new RegExp(nome, 'i');

    try {
        const reservas = await ReservaSchema.find(query);
        response.status(200).json(reservas);

    } catch (error) {
        response.status(500).json({
            message: error.message
        });
    }
}

const listarReservasCliente = async(req, response) => {

    try {
        const email = getUserEmail(req, response);
        if( typeof(email) !== 'string' ){ // error
            return;
        }

        const reservas = await ReservaSchema.find(
            { 
                status: 'ATIVA',
                responsavel: email
            } ).sort({ horarioInicio : 1 });
        
        response.status(200).json(reservas);

    } catch (error) {
        response.status(500).json({
            message: error.message
        });
    }
}

const atualizarReserva = async(reserva, req, response) => {
    const { id } = req.params;
    try {

        if( !reserva ) {
            return response.status(404).json({
                message: "reserva inexistente"
            });
        }

        if( reserva.status === "CANCELADA" && reserva.horarioInicio <= new Date()) {
            return response.status(404).json({
                message: "A reserva deve estar ativa e ainda n??o iniciada caso necessite ser alterada"
            });
        }

        const numeroDaMesa = reserva.numeroDaMesa;
        const mesa = await MesaSchema.findOne({numero: numeroDaMesa});

        if( !mesa ) {
            return response.status(404).json({
                message: "a mesa dessa reserva n??o existe"
            });
        }

        const {quantidade: quantidadeDePessoas} = req.body;
        if( quantidadeDePessoas <= 0 ) {
            return response.status(400).json({
                message: "Quantidade inv??lida"
            });
        }

        if( quantidadeDePessoas > mesa.capacidade ) {
            return response.status(400).json({
                message: "A nova quantidade ?? maior do que a capacidade da mesa"
            });
        }

        reserva.update({quantidadeDePessoas: quantidadeDePessoas});

        const biblioteca = await ReservaSchema.findByIdAndUpdate(id, {quantidadeDePessoas}, {returnDocument:'after'});
        
        response.status(200).send(biblioteca)
    } catch (error) {
        response.status(500).json({
            message: error.message
        });
    }
}

const atualizarReservaGerente = async(req, response) => {
    
    try {
        const { id } = req.params;
        const reserva = await ReservaSchema.findById(id);    
        atualizarReserva(reserva, req, response);
    } catch (error) {
        res.status(500).json({
            message: error.message
        });
    }
}

const atualizarReservaCliente = async(req, response) => {
    
    try {
        const { id } = req.params;
        const email = getUserEmail(req, response);
        const reserva = await ReservaSchema.findOne({id, responsavel: email});    
        atualizarReserva(reserva, req, response);
    } catch (error) {
        response.status(500).json({
            message: error.message
        });
    }
}

const cancelarReserva = async(req, res) => {
    const { id } = req.params;

    try {
        const reserva = await ReservaSchema.findById(id);

        if( !reserva) {
            return res.status(404).send("Reserva inexistente");    
        }

        await ReservaSchema.findByIdAndUpdate(id, {$set: {status: 'CANCELADA'} } );


        res.status(200).send({mensagem: "reserva cancelada"});
    } catch (error) {
        console.log(error)
        res.status(500).json({
            message: error.message
        });
    }
}

const cancelarReservaCliente = async(req, res) => {
    const { id } = req.params;

    try {
        const email = getUserEmail(req, res);
        const reserva = await ReservaSchema.findOne({id, responsavel: email});

        if( !reserva) {
            return res.status(404).send("Reserva inexistente");    
        }

        reserva.update({status: 'CANCELADA'});

        res.status(200).send({mensagem: "reserva cancelada"});
    } catch (error) {
        console.log(error)
        res.status(500).json({
            message: error.message
        });
    }
}

module.exports = {
    criarReservaCliente,
    criarReservaGerente,
    listarReservas,
    listarReservasCliente,
    cancelarReserva,
    cancelarReservaCliente,
    atualizarReservaCliente,
    atualizarReservaGerente,
    checarMesasRequest
}
