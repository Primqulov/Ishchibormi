package validator

import (
	"github.com/go-playground/validator/v10"
)

var V = validator.New()

func Struct(s any) error { return V.Struct(s) }
