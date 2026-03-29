/**
 * Classe de base pour la serialization automatique des objets avec des proprietes $state de Svelte 5.
 */
type SerializableDictionary = Record<string, unknown>;

type RegisteredSerializableClass<T extends SerializableBase = SerializableBase> = {
	new (): T;
	fromJSON(data: SerializableDictionary): T;
	__className?: string;
	name: string;
};

const hasClassName = (value: unknown): value is SerializableDictionary & { __className: string } =>
	typeof value === 'object' && value !== null && typeof (value as { __className?: unknown }).__className === 'string';

const hasFromJSON = <T extends SerializableBase>(
	value: unknown
): value is RegisteredSerializableClass<T> =>
	typeof value === 'function' &&
	typeof (value as { fromJSON?: unknown }).fromJSON === 'function' &&
	typeof (value as { name?: unknown }).name === 'string';

export class SerializableBase {
	// Nom de la classe pour la serialization - doit etre defini dans chaque classe fille.
	static __className = 'SerializableBase';

	// Metadonnees pour la deserialisation des objets enfants.
	private static __childClasses = new Map<string, Map<string, RegisteredSerializableClass>>();

	// Registre global des classes pour la deserialisation automatique.
	private static __classRegistry = new Map<string, RegisteredSerializableClass>();

	/**
	 * Enregistre une classe dans le registre global pour permettre la deserialisation automatique.
	 */
	static registerClass(className: string, classConstructor: RegisteredSerializableClass): void {
		this.__classRegistry.set(className, classConstructor);
		classConstructor.__className = className;
	}

	/**
	 * Decore une propriete pour indiquer qu'elle doit etre deserialisee avec une classe specifique.
	 */
	static registerChildClass(
		targetClass: { name: string },
		propertyKey: string,
		childClass: RegisteredSerializableClass
	): void {
		const className = targetClass.name;
		if (!this.__childClasses.has(className)) {
			this.__childClasses.set(className, new Map());
		}
		this.__childClasses.get(className)?.set(propertyKey, childClass);
	}

	/**
	 * Methode toJSON personnalisee qui capture automatiquement toutes les proprietes,
	 * y compris les proprietes $state de Svelte 5, et traite recursivement les objets imbriques.
	 */
	toJSON(): SerializableDictionary {
		return SerializableBase.serializeObject(this) as SerializableDictionary;
	}

	/**
	 * Serialise recursivement un objet, en ajoutant __className pour tous les objets SerializableBase.
	 */
	private static serializeObject(obj: unknown): unknown {
		if (obj === null || obj === undefined) {
			return obj;
		}

		if (typeof obj !== 'object') {
			return obj;
		}

		if (Array.isArray(obj)) {
			return obj.map((item) => SerializableBase.serializeObject(item));
		}

		if (obj instanceof Date) {
			return obj.toISOString();
		}

		const result: SerializableDictionary = {};
		if (obj instanceof SerializableBase) {
			let className: string | null = null;

			for (const [registeredName, registeredClass] of SerializableBase.__classRegistry.entries()) {
				if (obj.constructor === registeredClass) {
					className = registeredName;
					break;
				}
			}

			if (!className) {
				const constructorName = obj.constructor.name;
				if (SerializableBase.__classRegistry.has(constructorName)) {
					className = constructorName;
				}
			}

			if (!className) {
				const ctor = obj.constructor as { __className?: string; name: string };
				className = ctor.__className ?? ctor.name;
			}

			result.__className = className;
		}

		const instance = obj as SerializableDictionary;
		for (const key in instance) {
			if (Object.prototype.hasOwnProperty.call(instance, key)) {
				const value = instance[key];
				if (typeof value !== 'function') {
					result[key] = SerializableBase.serializeObject(value);
				}
			}
		}

		if (obj instanceof SerializableBase) {
			let proto: object | null = Object.getPrototypeOf(instance);
			while (proto && proto !== Object.prototype) {
				const descriptors = Object.getOwnPropertyDescriptors(proto);

				for (const [key, descriptor] of Object.entries(descriptors)) {
					if (key === 'constructor' || typeof descriptor.value === 'function') {
						continue;
					}

					if (descriptor.get && !Object.prototype.hasOwnProperty.call(result, key)) {
						try {
							const value = descriptor.get.call(instance);
							if (value !== undefined && typeof value !== 'function') {
								result[key] = SerializableBase.serializeObject(value);
							}
						} catch (_error) {
							// Ignore getter access errors.
						}
					}
				}

				proto = Object.getPrototypeOf(proto);
			}
		}

		return result;
	}

	/**
	 * Methode utilitaire pour restaurer les proprietes depuis un objet plain.
	 */
	static fromJSON<T extends SerializableBase>(
		this: RegisteredSerializableClass<T>,
		data: SerializableDictionary
	): T {
		const className = typeof data.__className === 'string' ? data.__className : undefined;
		const registeredClass =
			className && SerializableBase.__classRegistry.has(className)
				? SerializableBase.__classRegistry.get(className)
				: undefined;
		const targetClass = hasFromJSON<T>(registeredClass) ? registeredClass : this;

		const instance = new targetClass() as T & SerializableDictionary;
		const childClasses = SerializableBase.__childClasses.get(targetClass.name);

		for (const key in data) {
			if (!Object.prototype.hasOwnProperty.call(data, key) || key === '__className') {
				continue;
			}

			const value = data[key];
			if (childClasses?.has(key)) {
				const childClass = childClasses.get(key);
				if (Array.isArray(value)) {
					instance[key] = value.map((item) => {
						if (item && typeof item === 'object') {
							if (hasClassName(item) && SerializableBase.__classRegistry.has(item.__className)) {
								const itemClass = SerializableBase.__classRegistry.get(item.__className);
								if (hasFromJSON(itemClass)) return itemClass.fromJSON(item);
							}
							if (childClass && hasFromJSON(childClass)) return childClass.fromJSON(item);
						} else if (typeof item === 'string' && SerializableBase.isDateString(item)) {
							return new Date(item);
						}
						return item;
					});
				} else if (value && typeof value === 'object') {
					if (hasClassName(value) && SerializableBase.__classRegistry.has(value.__className)) {
						const itemClass = SerializableBase.__classRegistry.get(value.__className);
						instance[key] = hasFromJSON(itemClass) ? itemClass.fromJSON(value) : value;
					} else if (childClass && hasFromJSON(childClass)) {
						instance[key] = childClass.fromJSON(value as SerializableDictionary);
					} else {
						instance[key] = value;
					}
				} else if (typeof value === 'string' && SerializableBase.isDateString(value)) {
					instance[key] = new Date(value);
				} else {
					instance[key] = value;
				}
				continue;
			}

			if (value && typeof value === 'object' && !Array.isArray(value) && hasClassName(value)) {
				if (SerializableBase.__classRegistry.has(value.__className)) {
					const itemClass = SerializableBase.__classRegistry.get(value.__className);
					instance[key] = hasFromJSON(itemClass) ? itemClass.fromJSON(value) : value;
				} else {
					instance[key] = value;
				}
			} else if (Array.isArray(value)) {
				instance[key] = value.map((item) => {
					if (item && typeof item === 'object' && hasClassName(item)) {
						if (SerializableBase.__classRegistry.has(item.__className)) {
							const itemClass = SerializableBase.__classRegistry.get(item.__className);
							if (hasFromJSON(itemClass)) {
								return itemClass.fromJSON(item);
							}
						}
					} else if (typeof item === 'string' && SerializableBase.isDateString(item)) {
						return new Date(item);
					}
					return item;
				});
			} else if (value && typeof value === 'object' && !Array.isArray(value)) {
				const deserializedDict: SerializableDictionary = {};
				for (const dictKey in value) {
					if (Object.prototype.hasOwnProperty.call(value, dictKey)) {
						const dictValue = (value as SerializableDictionary)[dictKey];
						if (
							dictValue &&
							typeof dictValue === 'object' &&
							hasClassName(dictValue) &&
							SerializableBase.__classRegistry.has(dictValue.__className)
						) {
							const itemClass = SerializableBase.__classRegistry.get(dictValue.__className);
							deserializedDict[dictKey] = hasFromJSON(itemClass)
								? itemClass.fromJSON(dictValue)
								: dictValue;
						} else if (
							typeof dictValue === 'string' &&
							SerializableBase.isDateString(dictValue)
						) {
							deserializedDict[dictKey] = new Date(dictValue);
						} else {
							deserializedDict[dictKey] = dictValue;
						}
					}
				}
				instance[key] = deserializedDict;
			} else if (typeof value === 'string' && SerializableBase.isDateString(value)) {
				instance[key] = new Date(value);
			} else {
				instance[key] = value;
			}
		}

		return instance;
	}

	/**
	 * Methode utilitaire pour deserialiser automatiquement n'importe quel objet
	 * sans avoir a specifier la classe.
	 */
	static deserialize(data: unknown): unknown {
		if (!data || typeof data !== 'object') {
			return data;
		}

		if (Array.isArray(data)) {
			return data.map((item) => SerializableBase.deserialize(item));
		}

		if (hasClassName(data) && SerializableBase.__classRegistry.has(data.__className)) {
			const targetClass = SerializableBase.__classRegistry.get(data.__className);
			if (hasFromJSON(targetClass)) {
				return targetClass.fromJSON(data);
			}
		}

		return data;
	}

	/**
	 * Clone l'objet en passant par la serialisation/deserialisation.
	 */
	clone<T extends SerializableBase>(this: T): T {
		const constructorFn = this.constructor as { fromJSON(data: SerializableDictionary): T };
		const data = this.toJSON();
		return constructorFn.fromJSON(data);
	}

	/**
	 * Verifie si une chaine de caracteres represente une date ISO valide.
	 */
	private static isDateString(value: string): boolean {
		const isoDateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?$/;
		if (!isoDateRegex.test(value)) {
			return false;
		}

		const date = new Date(value);
		return !Number.isNaN(date.getTime());
	}
}
