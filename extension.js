const vscode = require('vscode');

//variables globales
/** @type {vscode.TextEditorDecorationType | null} */
let opacidadBajaDecoration = null;
/** @type {vscode.StatusBarItem | null} */
let miStatusBarItem = null;
let estaActivado = false;

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    console.log('La extensión "Foco Mental" con soporte Multi-Cursor ya está activa.');

    miStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    miStatusBarItem.command = 'foco-mental.toggle';
    context.subscriptions.push(miStatusBarItem);
    actualizarStatusBar();
    miStatusBarItem.show();

    let toggleCommand = vscode.commands.registerCommand('foco-mental.toggle', () => {
        estaActivado = !estaActivado;
        vscode.window.showInformationMessage(`Foco Mental: ${estaActivado ? 'Activado' : 'Desactivado'}`);
        
        actualizarStatusBar();
        const editor = vscode.window.activeTextEditor;
        
        if (editor) {
            if (!estaActivado) {
                limpiarDecoraciones(editor);
            } else {
                actualizarFoco(editor);
            }
        }
    });

    let cambiarSeleccion = vscode.window.onDidChangeTextEditorSelection((event) => {
        if (!estaActivado) return;
        actualizarFoco(event.textEditor);
    });

    let cambiarEditorActivo = vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (!estaActivado || !editor) return;
        actualizarFoco(editor);
    });

    let cambiarConfiguracion = vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('focoMental') && estaActivado) {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                limpiarDecoraciones(editor);
                actualizarFoco(editor);
            }
        }
    });

    context.subscriptions.push(toggleCommand, cambiarSeleccion, cambiarEditorActivo, cambiarConfiguracion);
}

/**
 * recupera el tipo de decoracion con la configuracion del usuario
 * @returns {vscode.TextEditorDecorationType}
 */
function obtenerTipoDecoracion() {
    if (opacidadBajaDecoration) {
        return opacidadBajaDecoration;
    }

    const config = vscode.workspace.getConfiguration('focoMental');
    const opacidad = config.get('opacidad', 0.25);
    const blur = config.get('desenfoque', 1);

    opacidadBajaDecoration = vscode.window.createTextEditorDecorationType({
        opacity: opacidad.toString(),
        textDecoration: `none; filter: blur(${blur}px); transition: filter 0.2s ease, opacity 0.2s ease;`
    });

    return opacidadBajaDecoration;
}

/**
 * elimina las decoraciones del editor
 * @param {vscode.TextEditor} editor
 */
function limpiarDecoraciones(editor) {
    if (opacidadBajaDecoration) {
        editor.setDecorations(opacidadBajaDecoration, []);
        opacidadBajaDecoration.dispose();
        opacidadBajaDecoration = null;
    }
}

/**
 * Actualiza el diseño del estado
 */
function actualizarStatusBar() {
    if (!miStatusBarItem) return;
    if (estaActivado) {
        miStatusBarItem.text = `$(eye) Foco: Activo`;
        miStatusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        miStatusBarItem.tooltip = 'Haz clic para desactivar Foco Mental';
    } else {
        miStatusBarItem.text = `$(eye-closed) Foco: Off`;
        miStatusBarItem.backgroundColor = undefined;
        miStatusBarItem.tooltip = 'Haz clic para activar Foco Mental';
    }
}

/**
 * Funcion que calcula el scope actual basandose en símbolos estructurales exactos
 * y soporta múltiples cursores simultáneos.
 * @param {vscode.TextEditor} editor 
 */
async function actualizarFoco(editor) {
    if (!editor) return;

    const documento = editor.document;
    const config = vscode.workspace.getConfiguration('focoMental');
    
    /** @type {string[]} */
    const lenguajesExcluidos = config.get('lenguajesExcluidos', []);

    if (lenguajesExcluidos.includes(documento.languageId)) {
        limpiarDecoraciones(editor);
        return;
    }

    const ultimaLineaDoc = documento.lineCount - 1;
    
    try {
        /** @type {vscode.DocumentSymbol[] | undefined} */
        const simbolos = await vscode.commands.executeCommand(
            'vscode.executeDocumentSymbolProvider',
            documento.uri
        );

        /** @type {vscode.DocumentSymbol[]} */
        const bloquesActivos = [];
        /** @type {vscode.DocumentSymbol[]} */
        const funcionesReferenciadas = [];

        if (simbolos && simbolos.length > 0) {
            for (const seleccion of editor.selections) {
                const posicionCursor = seleccion.active;
                
                const bloque = encontrarBloqueActual(simbolos, posicionCursor);
                if (bloque) {
                    if (!bloquesActivos.some(b => b.name === bloque.name)) {
                        bloquesActivos.push(bloque);
                    }
                }

                const rangoPalabra = documento.getWordRangeAtPosition(posicionCursor);
                if (rangoPalabra) {
                    const palabraBajoCursor = documento.getText(rangoPalabra);
                    if (!bloque || palabraBajoCursor !== bloque.name) {
                        const ref = buscarSimboloPorNombre(simbolos, palabraBajoCursor);
                        if (ref && !funcionesReferenciadas.some(r => r.name === ref.name)) {
                            funcionesReferenciadas.push(ref);
                        }
                    }
                }
            }
        }

        if (bloquesActivos.length > 0 || funcionesReferenciadas.length > 0) {
            /** @type {vscode.Range[]} */
            const rangosA_Desenfocar = [];
            const decType = obtenerTipoDecoracion();

            const nombresBloques = bloquesActivos.map(b => b.name);
            const nombresReferencias = funcionesReferenciadas.map(r => r.name);

            for (let i = 0; i <= ultimaLineaDoc; i++) {
                
                const estaEnBloqueActivo = bloquesActivos.some(bloque => i >= bloque.range.start.line && i <= bloque.range.end.line);
                if (estaEnBloqueActivo) continue;

                const estaEnFuncionRef = funcionesReferenciadas.some(ref => i >= ref.range.start.line && i <= ref.range.end.line);
                if (estaEnFuncionRef) continue;

                const textoLinea = documento.lineAt(i).text;

                const contieneLlamadaBloque = nombresBloques.some(nombre => nombre && textoLinea.includes(nombre));
                if (contieneLlamadaBloque) continue;

                const contieneLlamadaRef = nombresReferencias.some(nombre => nombre && textoLinea.includes(nombre));
                if (contieneLlamadaRef) continue;

                rangosA_Desenfocar.push(new vscode.Range(
                    new vscode.Position(i, 0),
                    new vscode.Position(i, textoLinea.length)
                ));
            }

            editor.setDecorations(decType, rangosA_Desenfocar);
        } else {
            const decType = obtenerTipoDecoracion();
            editor.setDecorations(decType, []);
        }

    } catch (error) {
        console.error("Error en la ejecución de Foco Mental:", error);
    }
}

/**
 * Busca de forma recursiva el símbolo más anidado que contenga la posición del cursor
 * @param {vscode.DocumentSymbol[]} simbolos 
 * @param {vscode.Position} posicion 
 * @returns {vscode.DocumentSymbol | null}
 */
function encontrarBloqueActual(simbolos, posicion) {
    /** @type {vscode.DocumentSymbol | null} */
    let candidato = null;

    for (const simbolo of simbolos) {
        if (simbolo.range.contains(posicion)) {
            candidato = simbolo;
            if (simbolo.children && simbolo.children.length > 0) {
                const hijoMasProfundo = encontrarBloqueActual(simbolo.children, posicion);
                if (hijoMasProfundo) {
                    candidato = hijoMasProfundo;
                }
            }
        }
    }
    return candidato;
}

/**
 * Busca en el arbol de símbolos una función o clase cuyo nombre coincida exactamente con el texto dado
 * @param {vscode.DocumentSymbol[]} simbolos 
 * @param {string} nombre 
 * @returns {vscode.DocumentSymbol | null}
 */
function buscarSimboloPorNombre(simbolos, nombre) {
    for (const simbolo of simbolos) {
        if (simbolo.name === nombre) {
            return simbolo;
        }
        if (simbolo.children && simbolo.children.length > 0) {
            const encontradoEnHijos = buscarSimboloPorNombre(simbolo.children, nombre);
            if (encontradoEnHijos) return encontradoEnHijos;
        }
    }
    return null;
}

function deactivate() {
    if (opacidadBajaDecoration) opacidadBajaDecoration.dispose();
    if (miStatusBarItem) miStatusBarItem.dispose();
}

module.exports = {
    activate,
    deactivate
}